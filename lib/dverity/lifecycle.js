const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = '.dverity/managed-skills.json';
const PROVENANCE_PATH = 'lib/dverity/package-provenance.json';
const HASH = /^[a-f0-9]{40}$/;

function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safePath(root, relative) {
  const target = path.resolve(root, relative);
  if (!isInside(root, target)) throw new Error(`Path escapes selected root: ${relative}`);
  const segments = path.relative(root, target).split(path.sep);
  let cursor = root;
  segments.forEach((segment, index) => {
    cursor = path.join(cursor, segment);
    const stat = lstat(cursor);
    if (stat?.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${cursor}`);
    if (stat && index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Managed path parent is not a directory: ${cursor}`);
    }
  });
  return target;
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

function createManifest(context) {
  return { ...staticManifest(context), transaction: transaction() };
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

function preflightInstall(scope, plan) {
  const legacy = safePath(scope.root, '.codex/.cc-devflow-managed-skills.json');
  if (lstat(legacy)) throw new Error(`Legacy-owned root requires dverity migrate: ${scope.root}`);
  if (lstat(plan.manifest)) throw new Error(`Dverity ownership manifest exists: ${plan.manifest}`);
  if (lstat(plan.temporary)) throw new Error(`Unknown temporary manifest collision: ${plan.temporary}`);
  const collision = plan.targets.find((target) => lstat(target.path));
  if (collision) throw new Error(`Unknown same-name collision: ${collision.path}`);
}

function copyTargets(plan) {
  for (const target of plan.targets) {
    for (const file of target.skill.files) {
      const destination = safePath(target.path, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(PACKAGE_ROOT, target.skill.path, file), destination);
    }
  }
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
    copyTargets(plan);
    writeManifest(plan, createManifest(context));
  } catch (error) {
    rollbackInstall(plan);
    throw error;
  }
  return { message: `Installed Dverity Skills at ${scope.root}` };
}

function migrate(scope) {
  throw new Error(`Migration is not available in this lifecycle slice: ${scope.root}`);
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

function runLifecycle(command, scope) {
  return ACTIONS[command](scope);
}

module.exports = {
  LIFECYCLE_COMMANDS,
  resolveScope,
  runLifecycle
};
