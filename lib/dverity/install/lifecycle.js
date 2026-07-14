const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  hashProjectionTree,
  inspectHostProjections,
  materializeHostProjections
} = require('./host-projections');
const migrationData = require('../migration/data');
const { safePath } = require('../migration/managed-path');
const { createMigrationTransfers, forwardOwnedTransfer, reverseOwnedTransfer } = require('../migration/owned-paths');
const PACKAGE_ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_PATH = '.dverity/managed-skills.json';
const MIGRATION_JOURNAL_PATH = '.dverity/migration-journal.json';
const PROVENANCE_PATH = 'lib/dverity/release/package-provenance.json';
const HASH = /^[a-f0-9]{40}$/;
const MIGRATION_SCHEMA = deepFreeze(require('../migration/transaction-schema.json'));
const LEGACY_SOURCE = MIGRATION_SCHEMA.legacy;
const LEGACY_SKILL_IDS = LEGACY_SOURCE.skills;
const LEGACY_PROJECTIONS = Object.keys(LEGACY_SOURCE.projections);
const LEGACY_MARKER_PATH = /* dverity:legacy-input:start */ '.codex/.cc-devflow-managed-skills.json';
// dverity:legacy-input:end
const EDGE = Object.freeze(Object.fromEntries(MIGRATION_SCHEMA.steps
  .flatMap(({ mutationEdges }) => mutationEdges)
  .map((id) => [id.replaceAll('-', '_').toUpperCase(), id])));
const STEP_RUNNERS = Object.freeze({
  preflight: null, stage: stageMigration, verify: verifyStagedMigration,
  data: migrationData.stageMigrationData, commit: commitMigration,
  'post-readback': verifyCommittedMigration, cleanup: cleanupMigration
});
const MIGRATION_DEFINITION = bindMigrationSteps(MIGRATION_SCHEMA.steps, STEP_RUNNERS);
const PREFLIGHT_STEP = MIGRATION_DEFINITION.find(({ run }) => run === null);
const EXECUTION_STEPS = MIGRATION_DEFINITION.filter(({ run }) => run !== null);
const MIGRATION_FAULT_POINTS = Object.freeze(MIGRATION_DEFINITION.flatMap((step) => (
  [step.id, ...step.mutationEdges].flatMap((id) => [`before:${id}`, `after:${id}`])
)));

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

function bindMigrationSteps(steps, runners) {
  const ids = steps.map(({ id }) => id).sort();
  if (!sameJson(ids, Object.keys(runners).sort())) {
    throw new Error('Migration schema and runner IDs must match exactly');
  }
  return Object.freeze(steps.map((step) => Object.freeze({ ...step, run: runners[step.id] })));
}

function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashRecords(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\0`);
  return hash.digest('hex');
}

function sourceFiles(source) {
  return source.skills.flatMap((skill) => skill.files.map((file) => {
    const packagePath = `${skill.path}/${file}`;
    return {
      path: `${skill.id}/${file}`,
      packagePath,
      sha256: sha256(fs.readFileSync(path.join(PACKAGE_ROOT, packagePath)))
    };
  }));
}

function sourceCommit() {
  const provenance = path.join(PACKAGE_ROOT, PROVENANCE_PATH);
  if (lstat(provenance)?.isFile()) {
    const value = JSON.parse(fs.readFileSync(provenance, 'utf8'));
    if (value.schema_version === 1 && HASH.test(value.source_commit || '')) {
      return value.source_commit;
    }
    throw new Error('Invalid Dverity package provenance');
  }
  if (!lstat(path.join(PACKAGE_ROOT, '.git'))) {
    throw new Error('Dverity package source commit provenance is missing');
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8'
  });
  const commit = result.status === 0 ? result.stdout.trim() : '';
  if (!HASH.test(commit)) throw new Error('Dverity source commit provenance is unavailable');
  return commit;
}

function packageFiles(pkg, files) {
  const declared = pkg.files.filter((file) => file !== 'skills/');
  const paths = ['package.json', ...declared, ...files.map(({ packagePath }) => packagePath)];
  return paths.sort().filter((file) => file !== PROVENANCE_PATH || lstat(path.join(PACKAGE_ROOT, file)))
    .map((file) => ({
    path: file,
    sha256: sha256(fs.readFileSync(path.join(PACKAGE_ROOT, file)))
    }));
}

function ownershipContext() {
  const { buildSkillProvenance } = require('./skill-source');
  const graph = buildSkillProvenance({ root: PACKAGE_ROOT });
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const files = sourceFiles(graph.source);
  return {
    graph,
    files,
    commit: sourceCommit(),
    artifactHash: hashRecords(packageFiles(pkg, files)),
    projections: Object.values(graph.projections).map(({ root }) => root)
  };
}

function projectionRecords(context) {
  const files = context.files.map(({ path: filePath, sha256: hash }) => ({
    path: filePath,
    sha256: hash
  }));
  return context.projections.map((root) => ({ root, files }));
}

function staticManifest(context) {
  const { graph } = context;
  return {
    schemaVersion: 1,
    package: graph.package.identity,
    source: {
      root: graph.source.source_root,
      commit: context.commit,
      hash: graph.source.source_hash,
      enumerationRun: graph.source.enumeration_run
    },
    artifact: { kind: 'package-content', algorithm: 'sha256', hash: context.artifactHash },
    skills: graph.source.skills.map(({ id }) => id),
    projections: projectionRecords(context)
  };
}

function transaction() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    state: 'committed',
    startedAt: now,
    committedAt: now
  };
}

function createManifest(context, value = transaction()) {
  return { ...staticManifest(context), transaction: value };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && sameJson(Object.keys(value).sort(), [...keys].sort());
}

function invalidManifest(reason) {
  throw new Error(`Invalid ownership manifest: ${reason}`);
}

function validateTransaction(value) {
  const keys = ['id', 'state', 'startedAt', 'committedAt'];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!hasExactKeys(value, keys) || !uuid.test(value.id) || value.state !== 'committed') {
    invalidManifest('transaction state');
  }
  if (!Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.committedAt))) {
    invalidManifest('transaction timestamps');
  }
}

function validateManifest(manifest, context) {
  const keys = [...Object.keys(staticManifest(context)), 'transaction'];
  if (!hasExactKeys(manifest, keys)) invalidManifest('unexpected top-level shape');
  const { transaction: value, ...actual } = manifest;
  if (!sameJson(actual, staticManifest(context))) invalidManifest('ownership provenance');
  validateTransaction(value);
  return manifest;
}

function readManifest(scope, context) {
  const manifestFile = safePath(scope.root, MANIFEST_PATH);
  if (!lstat(manifestFile)) throw new Error(`Missing ownership manifest: ${manifestFile}`);
  try {
    return validateManifest(JSON.parse(fs.readFileSync(manifestFile, 'utf8')), context);
  } catch (error) {
    if (error.message.startsWith('Invalid ownership manifest:')) throw error;
    invalidManifest(error.message);
  }
}

function scanEntries(target, relative, expectedFiles) {
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const entryRelative = `${relative}/${entry.name}`;
    const entryPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unknown managed symlink: ${entryPath}`);
    if (entry.isDirectory()) {
      if (![...expectedFiles].some((file) => file.startsWith(`${entryRelative}/`))) {
        throw new Error(`Unknown managed path: ${entryPath}`);
      }
      scanEntries(entryPath, entryRelative, expectedFiles);
    } else if (!entry.isFile() || !expectedFiles.has(entryRelative)) {
      throw new Error(`Unknown managed path: ${entryPath}`);
    }
  }
}

function inspectFile(scope, projection, file) {
  const target = safePath(scope.root, `${projection.root}/${file.path}`);
  if (!lstat(target)?.isFile()) throw new Error(`Missing managed file: ${target}`);
  if (sha256(fs.readFileSync(target)) !== file.sha256) {
    throw new Error(`Managed file drift: ${target}`);
  }
}

function inspectProjection(scope, manifest, projection) {
  const expected = new Set(projection.files.map(({ path: filePath }) => filePath));
  for (const skill of manifest.skills) {
    const skillRoot = safePath(scope.root, `${projection.root}/${skill}`);
    if (!lstat(skillRoot)?.isDirectory()) throw new Error(`Missing managed Skill: ${skillRoot}`);
    scanEntries(skillRoot, skill, expected);
  }
  for (const file of projection.files) inspectFile(scope, projection, file);
}

function inspectOwnership(scope) {
  const context = ownershipContext();
  const manifest = readManifest(scope, context);
  for (const projection of manifest.projections) inspectProjection(scope, manifest, projection);
  return manifest;
}

function projectRoot(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('--project requires an absolute path');
  const stat = lstat(value);
  if (!stat?.isDirectory()) throw new Error(`Project root is not an existing directory: ${value}`);
  const resolved = path.resolve(value);
  if (fs.realpathSync(value) !== resolved) {
    throw new Error(`Project root must be canonical and contain no symlink: ${value}`);
  }
  return resolved;
}

function resolveScope(args) {
  const globals = args.filter((arg) => arg === '--global').length;
  const projects = args.filter((arg) => arg === '--project').length;
  if (globals + projects !== 1) {
    throw new Error('Choose exactly one scope: --global or --project <absolute-path>');
  }
  if (globals === 1) {
    if (args.length !== 1) throw new Error('--global does not accept additional arguments');
    return { root: fs.realpathSync(os.homedir()) };
  }
  if (args.length !== 2 || args[0] !== '--project') {
    throw new Error('--project requires exactly one absolute path');
  }
  return { root: projectRoot(args[1]) };
}

function installPlan(scope, context) {
  const skills = context.graph.source.skills;
  const targets = context.projections.flatMap((projection) => (
    skills.map((skill) => ({ projection, skill, path: safePath(scope.root, `${projection}/${skill.id}`) }))
  ));
  const directories = ['.agents', '.agents/skills', '.claude', '.claude/skills', '.dverity']
    .map((relative) => safePath(scope.root, relative))
    .filter((target) => !lstat(target));
  const manifest = safePath(scope.root, MANIFEST_PATH);
  return {
    targets,
    directories,
    manifest,
    temporary: `${manifest}.tmp-${crypto.randomUUID()}`,
    temporaryCreated: false
  };
}

function preflightInstall(scope, plan) { // dverity:legacy-input:start
  const legacy = safePath(scope.root, LEGACY_MARKER_PATH);
  if (lstat(legacy)) throw new Error(`Legacy-owned root requires dverity migrate: ${scope.root}`);
  if (lstat(plan.manifest)) throw new Error(`Dverity ownership manifest exists: ${plan.manifest}`);
  if (lstat(plan.temporary)) throw new Error(`Unknown temporary manifest collision: ${plan.temporary}`);
  const collision = plan.targets.find((target) => lstat(target.path));
  if (collision) throw new Error(`Unknown same-name collision: ${collision.path}`);
} // dverity:legacy-input:end

function projectionInput(scope, context) {
  return {
    artifactRoot: PACKAGE_ROOT,
    installRoot: scope.root,
    files: context.files,
    projections: context.projections
  };
}

function writeManifest(plan, manifest) {
  fs.mkdirSync(path.dirname(plan.manifest), { recursive: true });
  fs.writeFileSync(plan.temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  plan.temporaryCreated = true;
  fs.renameSync(plan.temporary, plan.manifest);
  plan.temporaryCreated = false;
}

function rollbackInstall(plan) {
  for (const target of [...plan.targets].reverse()) fs.rmSync(target.path, { recursive: true, force: true });
  if (plan.temporaryCreated) fs.rmSync(plan.temporary, { force: true });
  for (const directory of [...plan.directories].reverse()) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    }
  }
}

function install(scope) {
  const context = ownershipContext();
  const plan = installPlan(scope, context);
  preflightInstall(scope, plan);
  try {
    const projections = projectionInput(scope, context);
    materializeHostProjections(projections);
    inspectHostProjections(projections);
    writeManifest(plan, createManifest(context));
  } catch (error) {
    rollbackInstall(plan);
    throw error;
  }
  return { message: `Installed Dverity Skills at ${scope.root}` };
}

function unknownLegacy(reason) {
  throw new Error(`Unknown legacy ownership: ${reason}`);
}

function parseJson(file, description) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${description}: ${error.message}`);
  }
}

function readLegacyMarker(scope) { // dverity:legacy-input:start
  const markerPath = safePath(scope.root, LEGACY_MARKER_PATH);
  if (!lstat(markerPath)?.isFile()) unknownLegacy('owned-v4 marker is missing');
  try {
    return parseJson(markerPath, 'owned-v4 marker');
  } catch (error) {
    unknownLegacy(error.message);
    return null;
  }
}

function validateLegacyProjection(scope, projection) {
  let projectionRoot;
  try { projectionRoot = safePath(scope.root, projection); }
  catch (error) { unknownLegacy(`${projection}: ${error.message}`); }
  if (!lstat(projectionRoot)?.isDirectory()) unknownLegacy(`${projection} is partial`);
  const entries = fs.readdirSync(projectionRoot).sort();
  if (!LEGACY_SKILL_IDS.every((skill) => entries.includes(skill))) {
    unknownLegacy(`${projection} is partial`);
  }
  if (hashProjectionTree(projectionRoot, LEGACY_SKILL_IDS)
    !== LEGACY_SOURCE.projections[projection]) {
    unknownLegacy(`${projection} does not match frozen v4 provenance`);
  }
}

function validateLegacyMarker(scope) {
  const marker = readLegacyMarker(scope);
  if (!hasExactKeys(marker, ['skills'])) unknownLegacy('marker schema is forged');
  if (!sameJson(marker.skills, LEGACY_SKILL_IDS)) unknownLegacy('skill inventory is partial');
  for (const projection of LEGACY_PROJECTIONS) validateLegacyProjection(scope, projection);
  return { marker, provenance: legacyProvenance() };
} // dverity:legacy-input:end

function legacyProvenance() {
  return {
    package: LEGACY_SOURCE.package,
    source: { commit: LEGACY_SOURCE.commit },
    projections: LEGACY_SOURCE.projections
  };
}

function migrationPlan(scope, context, legacy, options) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const transactionValue = { id, state: 'committed', startedAt: now, committedAt: now };
  const transactionRoot = safePath(scope.root, `.dverity/transactions/${id}`);
  const plan = {
    legacy,
    context,
    transaction: transactionValue,
    journal: safePath(scope.root, MIGRATION_JOURNAL_PATH),
    transactionRoot,
    stage: path.join(transactionRoot, 'stage'),
    backup: path.join(transactionRoot, 'backup'),
    stagedManifest: path.join(transactionRoot, 'staged-managed-skills.json'),
    manifest: safePath(scope.root, MANIFEST_PATH),
    unknownClaudeSkills: fs.readdirSync(safePath(scope.root, '.claude/skills'))
      .filter((skill) => !LEGACY_SKILL_IDS.includes(skill))
      .sort()
  };
  const dveritySkills = context.graph.source.skills.map(({ id: skill }) => skill);
  Object.assign(plan, createMigrationTransfers({
    root: scope.root,
    backupRoot: plan.backup,
    stageRoot: plan.stage,
    legacySkills: LEGACY_SKILL_IDS,
    dveritySkills,
    legacyMarkerPath: LEGACY_MARKER_PATH
  }));
  plan.data = migrationData.planDataMigration({
    root: scope.root,
    transactionRoot,
    backupRoot: plan.backup,
    externalReferencePaths: options.externalReferencePaths,
    onRead: options.onDataRead
  });
  return plan;
}
function preflightMigration(scope, context) {
  if (lstat(safePath(scope.root, MANIFEST_PATH))) return { alreadyMigrated: true };
  if (lstat(safePath(scope.root, '.dverity'))) unknownLegacy('.dverity collision');
  const legacy = validateLegacyMarker(scope);
  const dveritySkills = context.graph.source.skills.map(({ id }) => id);
  for (const projection of context.projections) {
    let projectionRoot;
    try { projectionRoot = safePath(scope.root, projection); }
    catch (error) { unknownLegacy(`${projection}: ${error.message}`); }
    const stat = lstat(projectionRoot);
    if (stat && !stat.isDirectory()) unknownLegacy(`${projection} collision`);
    const collision = stat && fs.readdirSync(projectionRoot)
      .find((skill) => dveritySkills.includes(skill)
        && !(projection === '.claude/skills' && LEGACY_SKILL_IDS.includes(skill)));
    if (collision) unknownLegacy(`unknown ${projection} Skill collides with Dverity: ${collision}`);
  }
  return { legacy };
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, file);
}

function saveJournal(plan, journal) {
  const temporary = `${plan.journal}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, plan.journal);
}

function removeTransactionArtifacts(plan) {
  fs.rmSync(plan.transactionRoot, { recursive: true, force: true });
  try {
    fs.rmdirSync(path.dirname(plan.transactionRoot));
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
}

function checkpoint(options, phase, id) {
  if (options.fault) options.fault(`${phase}:${id}`);
}

function migrationJournal(plan) {
  return {
    schemaVersion: 1,
    state: 'active',
    transaction: plan.transaction,
    legacy: plan.legacy.provenance,
    dataMigration: plan.data.journal,
    preservedUnknown: plan.unknownClaudeSkills,
    steps: MIGRATION_SCHEMA.steps,
    completedSteps: ['preflight'],
    completedEdges: [],
    compensations: [],
    error: null
  };
}

function runStep(options, id, action) {
  checkpoint(options, 'before', id);
  const result = action();
  checkpoint(options, 'after', id);
  return result;
}

function stageMigration(scope, plan, journal, edge) {
  edge(EDGE.JOURNAL_CREATE, () => {
    fs.mkdirSync(path.dirname(plan.journal), { recursive: true });
    fs.writeFileSync(plan.journal, `${JSON.stringify(journal, null, 2)}\n`, {
      flag: 'wx'
    });
  });
  edge(EDGE.STAGE_PROJECTIONS, () => materializeHostProjections({
    ...projectionInput({ root: plan.stage }, plan.context),
    installRoot: plan.stage
  }), () => fs.rmSync(plan.stage, { recursive: true, force: true }));
  edge(EDGE.STAGE_UNKNOWN, () => {
    for (const skill of plan.unknownClaudeSkills) {
      fs.cpSync(
        path.join(scope.root, '.claude/skills', skill),
        path.join(plan.stage, '.claude/skills', skill),
        { recursive: true, preserveTimestamps: true, verbatimSymlinks: true }
      );
    }
  }, () => {
    for (const skill of plan.unknownClaudeSkills) {
      fs.rmSync(path.join(plan.stage, '.claude/skills', skill), { recursive: true, force: true });
    }
  });
  edge(EDGE.STAGE_MANIFEST, () => {
    writeJsonAtomic(plan.stagedManifest, createManifest(plan.context, plan.transaction));
  }, () => fs.rmSync(plan.stagedManifest, { force: true }));
}

function verifyStagedMigration(_scope, plan) {
  return inspectHostProjections({
    ...projectionInput({ root: plan.stage }, plan.context),
    installRoot: plan.stage
  });
}

function commitMigration(scope, plan, _journal, edge) {
  edge(EDGE.RETIRE_CODEX, () => forwardOwnedTransfer(plan.legacyCodex),
    () => reverseOwnedTransfer(plan.legacyCodex));
  edge(EDGE.RETIRE_CLAUDE, () => forwardOwnedTransfer(plan.legacyClaude),
    () => reverseOwnedTransfer(plan.legacyClaude));
  migrationData.retireEvidenceSet(plan.data, edge);
  edge(EDGE.PUBLISH_AGENTS, () => forwardOwnedTransfer(plan.publishAgents),
    () => reverseOwnedTransfer(plan.publishAgents));
  edge(EDGE.PUBLISH_CLAUDE, () => forwardOwnedTransfer(plan.publishClaude),
    () => reverseOwnedTransfer(plan.publishClaude));
  migrationData.publishEvidenceSet(plan.data, edge);
  edge(EDGE.PUBLISH_MANIFEST, () => fs.renameSync(plan.stagedManifest, plan.manifest), () => {
    fs.rmSync(plan.manifest, { force: true });
  });
}

function verifyCommittedMigration(scope, plan) {
  const manifest = inspectOwnership(scope);
  if (manifest.transaction.id !== plan.transaction.id) {
    throw new Error('Migration post-readback does not match the transaction');
  }
  assertNoLegacyManagedSurface(scope, manifest);
  migrationData.verifyCommittedData(plan.data);
}

function cleanupMigration(_scope, plan, _journal, edge) {
  edge(EDGE.TRANSACTION_CLEANUP, () => removeTransactionArtifacts(plan));
}

function runCompensation(compensation, options) {
  try {
    if (options.compensationFault) options.compensationFault(compensation.id);
    compensation.run();
    return { id: compensation.id, restored: true };
  } catch (failure) {
    try {
      compensation.run();
      return { id: compensation.id, restored: true, error: failure.message };
    } catch (retryFailure) {
      return { id: compensation.id, restored: false,
        error: failure.message, retryError: retryFailure.message };
    }
  }
}

function cleanupRollbackArtifacts(plan, outcomes) {
  if (outcomes.some(({ restored }) => !restored)) return null;
  try {
    removeTransactionArtifacts(plan);
    return null;
  } catch (error) {
    return `transaction-cleanup: ${error.message}`;
  }
}

function rollbackMigration(plan, journal, compensations, error, options) {
  const outcomes = [...compensations].reverse()
    .map((compensation) => runCompensation(compensation, options));
  const cleanupErrors = outcomes.filter(({ error: failure }) => failure)
    .map(({ id, error: failure }) => `${id}: ${failure}`);
  const unrecovered = outcomes.filter(({ restored }) => !restored)
    .map(({ id, retryError }) => `${id}: ${retryError}`);
  const artifactError = cleanupRollbackArtifacts(plan, outcomes);
  if (artifactError) cleanupErrors.push(artifactError);
  journal.compensations.push(...outcomes.filter(({ restored }) => restored).map(({ id }) => id));
  journal.state = unrecovered.length ? 'compensation-failed' : 'rolled-back';
  journal.error = error.message;
  if (cleanupErrors.length) journal.cleanupErrors = cleanupErrors;
  if (unrecovered.length) journal.unrecovered = unrecovered;
  if (lstat(plan.journal)) saveJournal(plan, journal);
  const failures = [...cleanupErrors, ...unrecovered];
  if (failures.length) throw new Error(`${error.message}; compensation failed: ${failures.join('; ')}`);
}

function migrationRecorder(plan, journal, options) {
  const compensations = [];
  let activeStep = null;
  let edgeIndex = 0;

  function step(definition, action) {
    activeStep = definition;
    edgeIndex = 0;
    checkpoint(options, 'before', definition.id);
    const result = action();
    if (edgeIndex !== definition.mutationEdges.length) {
      throw new Error(`Migration step omitted declared edges: ${definition.id}`);
    }
    journal.completedSteps.push(definition.id);
    if (lstat(plan.journal)) saveJournal(plan, journal);
    checkpoint(options, 'after', definition.id);
    return result;
  }

  function edge(id, forward, compensate) {
    if (activeStep?.mutationEdges[edgeIndex] !== id) {
      throw new Error(`Undeclared or out-of-order migration edge: ${id}`);
    }
    checkpoint(options, 'before', id);
    forward();
    if (compensate) compensations.push({ id, run: compensate });
    journal.completedEdges.push(id);
    edgeIndex += 1;
    if (id !== EDGE.JOURNAL_CREATE) saveJournal(plan, journal);
    checkpoint(options, 'after', id);
  }

  return { compensations, edge, step };
}

function migrateOwnedRoot(scope, plan, options) {
  const journal = migrationJournal(plan);
  const recorder = migrationRecorder(plan, journal, options);
  let committed = false;

  try {
    for (const definition of EXECUTION_STEPS) {
      recorder.step(definition, () => definition.run(scope, plan, journal, recorder.edge));
      if (definition.commitPoint) {
        journal.state = 'committed';
        journal.error = null;
        saveJournal(plan, journal);
        committed = true;
      }
    }
  } catch (error) {
    if (!committed) rollbackMigration(plan, journal, recorder.compensations, error, options);
    else {
      removeTransactionArtifacts(plan);
      if (!journal.completedEdges.includes(EDGE.TRANSACTION_CLEANUP)) {
        journal.completedEdges.push(EDGE.TRANSACTION_CLEANUP);
      }
      if (!journal.completedSteps.includes('cleanup')) journal.completedSteps.push('cleanup');
      journal.cleanupError = error.message;
      saveJournal(plan, journal);
    }
    throw error;
  }
}

function assertNoLegacyManagedSurface(scope, manifest) {
  if (lstat(safePath(scope.root, LEGACY_MARKER_PATH))) {
    throw new Error('Mixed legacy marker remains');
  }
  const oldCodexSkill = LEGACY_SKILL_IDS
    .find((skill) => lstat(safePath(scope.root, `.codex/skills/${skill}`)));
  if (oldCodexSkill) throw new Error(`Mixed legacy Codex Skill remains: ${oldCodexSkill}`);
  const oldSkill = LEGACY_SKILL_IDS
    .filter((skill) => !manifest.skills.includes(skill))
    .find((skill) => lstat(safePath(scope.root, `.claude/skills/${skill}`)));
  if (oldSkill) throw new Error(`Mixed legacy Skill remains: ${oldSkill}`);
}
function validateCommittedJournal(scope, manifest, journal) {
  const keys = [
    'schemaVersion', 'state', 'transaction', 'legacy', 'dataMigration', 'preservedUnknown',
    'steps', 'completedSteps', 'completedEdges', 'compensations', 'error'
  ];
  if (typeof journal.cleanupError === 'string') keys.push('cleanupError');
  const unknown = fs.readdirSync(safePath(scope.root, '.claude/skills'))
    .filter((skill) => !manifest.skills.includes(skill))
    .sort();
  const expectedSteps = MIGRATION_DEFINITION.map(({ id }) => id);
  const expectedEdges = MIGRATION_DEFINITION.flatMap(({ mutationEdges }) => mutationEdges);
  const valid = hasExactKeys(journal, keys)
    && journal.schemaVersion === 1
    && journal.state === 'committed'
    && sameJson(journal.transaction, manifest.transaction)
    && sameJson(journal.legacy, legacyProvenance())
    && sameJson(journal.preservedUnknown, unknown)
    && sameJson(journal.steps, MIGRATION_SCHEMA.steps)
    && sameJson(journal.completedSteps, expectedSteps)
    && sameJson(journal.completedEdges, expectedEdges)
    && sameJson(journal.compensations, [])
    && journal.error === null;
  if (!valid) throw new Error('Migration journal does not match committed transaction evidence');
  migrationData.validateCommittedData(scope.root, journal.dataMigration);
}

function readCommittedMigration(scope, manifest) {
  const journalPath = safePath(scope.root, MIGRATION_JOURNAL_PATH);
  if (!lstat(journalPath)?.isFile()) throw new Error('Missing committed migration journal');
  const journal = parseJson(journalPath, 'migration journal');
  assertNoLegacyManagedSurface(scope, manifest);
  validateCommittedJournal(scope, manifest, journal);
}

function migrate(scope, options = {}) {
  const context = ownershipContext();
  let preflight;
  runStep(options, PREFLIGHT_STEP.id, () => {
    preflight = preflightMigration(scope, context);
  });
  if (preflight.alreadyMigrated) {
    const manifest = inspectOwnership(scope);
    readCommittedMigration(scope, manifest);
    return { message: `Dverity already migrated at ${scope.root}` };
  }
  const plan = migrationPlan(scope, context, preflight.legacy, options);
  migrateOwnedRoot(scope, plan, options);
  const suffix = plan.data.journal.fullyClean ? '' : '; Unknown external references reported';
  return { message: `Migrated owned legacy install at ${scope.root}${suffix}` };
}

function verify(scope) {
  inspectOwnership(scope);
  return { message: `Verified Dverity ownership at ${scope.root}` };
}

function uninstall(scope) {
  const manifest = inspectOwnership(scope);
  for (const projection of manifest.projections) {
    for (const skill of manifest.skills) {
      fs.rmSync(safePath(scope.root, `${projection.root}/${skill}`), { recursive: true });
    }
  }
  fs.rmSync(safePath(scope.root, MANIFEST_PATH));
  return { message: `Uninstalled Dverity Skills from ${scope.root}` };
}

const ACTIONS = Object.freeze({ install, migrate, verify, uninstall });
const LIFECYCLE_COMMANDS = Object.freeze(Object.keys(ACTIONS));

function runLifecycle(command, scope, options) {
  return ACTIONS[command](scope, options);
}

module.exports = {
  inspectOwnership,
  LIFECYCLE_COMMANDS,
  MIGRATION_FAULT_POINTS,
  MIGRATION_SCHEMA,
  resolveScope,
  runLifecycle
};
