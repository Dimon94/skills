const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EVIDENCE = Object.freeze([
  Object.freeze({ id: 'postmortems', source: 'devflow/postmortems', destination: 'docs/postmortems' }),
  Object.freeze({ id: 'research', source: 'devflow/research', destination: 'docs/research' })
]);
const EXTERNAL_FILES = Object.freeze([
  '.profile', '.bash_profile', '.bashrc', '.zprofile', '.zshrc',
  '.env', '.env.local', '.gitlab-ci.yml', '.github/workflows'
]);
const LEGACY_REFERENCE = /(?:CC_DEVFLOW_|\.cc-devflow(?:[\\/]|$)|\bcc-devflow\b)/;

function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function portable(relative) {
  return relative.split(path.sep).join('/');
}

function displayPath(root, target) {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? target
    : portable(relative);
}

function dataPath(root, relative) {
  const target = path.resolve(root, relative);
  const display = path.relative(root, target);
  if (display === '..' || display.startsWith(`..${path.sep}`) || path.isAbsolute(display)) {
    throw new Error(`Durable evidence path escapes selected root: ${relative}`);
  }
  let cursor = root;
  for (const segment of display.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (lstat(cursor)?.isSymbolicLink()) {
      throw new Error(`Durable evidence path cannot contain a symlink: ${cursor}`);
    }
  }
  return target;
}

function read(root, target, onRead) {
  if (onRead) onRead(displayPath(root, target));
  return fs.readFileSync(target);
}

function fileRecord(root, target, source, destination, onRead) {
  const stat = lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`Unknown durable evidence symlink: ${target}`);
  const record = {
    source,
    destination,
    type: stat.isDirectory() ? 'directory' : 'file',
    mode: stat.mode & 0o7777
  };
  if (stat.isFile()) record.sha256 = crypto.createHash('sha256')
    .update(read(root, target, onRead)).digest('hex');
  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error(`Unknown durable evidence path type: ${target}`);
  }
  return record;
}

function evidenceRecords(root, actualRoot, definition, onRead) {
  function visit(target, suffix = '') {
    const source = suffix ? `${definition.source}/${suffix}` : definition.source;
    const destination = suffix ? `${definition.destination}/${suffix}` : definition.destination;
    const record = fileRecord(root, target, source, destination, onRead);
    if (record.type === 'file') return [record];
    return [record, ...fs.readdirSync(target).sort().flatMap((entry) => (
      visit(path.join(target, entry), suffix ? `${suffix}/${entry}` : entry)
    ))];
  }
  return visit(actualRoot);
}

function externalFiles(target) {
  const stat = lstat(target);
  if (!stat) return [];
  if (stat.isSymbolicLink() || stat.isFile()) return [target];
  if (!stat.isDirectory()) return [target];
  return fs.readdirSync(target).sort().flatMap((entry) => externalFiles(path.join(target, entry)));
}

function externalReferences(root, extraPaths, onRead) {
  const candidates = [...EXTERNAL_FILES.map((relative) => path.join(root, relative)), ...(extraPaths || [])]
    .map((target) => path.isAbsolute(target) ? target : path.resolve(root, target));
  return [...new Set(candidates.flatMap(externalFiles))].sort().flatMap((target) => {
    const stat = lstat(target);
    const evidenceGap = 'manifest-external legacy reference';
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return [{ path: displayPath(root, target), evidenceGap, nextOwner: 'root operator' }];
    }
    return LEGACY_REFERENCE.test(read(root, target, onRead).toString('utf8'))
      ? [{ path: displayPath(root, target), evidenceGap, nextOwner: 'root operator' }]
      : [];
  });
}

function planDataMigration({ root, transactionRoot, backupRoot, externalReferencePaths, onRead }) {
  const items = EVIDENCE.map((definition) => {
    const sourcePath = dataPath(root, definition.source);
    const destinationPath = dataPath(root, definition.destination);
    const present = Boolean(lstat(sourcePath));
    if (present && !lstat(sourcePath).isDirectory()) {
      throw new Error(`Unknown durable evidence root: ${sourcePath}`);
    }
    if (present && lstat(destinationPath)) {
      throw new Error(`Unknown durable evidence destination collision: ${destinationPath}`);
    }
    return {
      ...definition,
      present,
      sourcePath,
      destinationPath,
      stagePath: path.join(transactionRoot, `data-${definition.id}`),
      backupPath: path.join(backupRoot, `data-${definition.id}`),
      provenance: present ? evidenceRecords(root, sourcePath, definition, onRead) : []
    };
  });
  const references = externalReferences(root, externalReferencePaths, onRead);
  const destinationRoot = dataPath(root, 'docs');
  const destinationStat = lstat(destinationRoot);
  if (items.some(({ present }) => present) && destinationStat && !destinationStat.isDirectory()) {
    throw new Error(`Unknown docs root: ${destinationRoot}`);
  }
  return {
    root,
    items,
    destinationRoot,
    destinationRootWillCreate: items.some(({ present }) => present) && !destinationStat,
    destinationRootCreated: false,
    onRead,
    journal: {
      roots: items.map(({ source, destination, present }) => ({
        source,
        destination,
        outcome: present ? 'migrated' : 'absent'
      })),
      provenance: items.flatMap(({ provenance }) => provenance),
      externalReferences: references,
      fullyClean: references.length === 0
    }
  };
}

function item(plan, id) {
  return plan.items.find((candidate) => candidate.id === id);
}

function stageEvidence(plan, id) {
  const current = item(plan, id);
  if (!current.present) return;
  fs.cpSync(current.sourcePath, current.stagePath, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true
  });
}

function removeStagedEvidence(plan, id) {
  fs.rmSync(item(plan, id).stagePath, { recursive: true, force: true });
}

function evidenceEdge(plan, edge, edgeId, id, forward, reverse) {
  const present = item(plan, id).present;
  edge(edgeId, () => forward(plan, id), present ? () => reverse(plan, id) : undefined);
}

function verifyStagedEvidence(plan) {
  const actual = plan.items.flatMap((current) => current.present
    ? evidenceRecords(plan.root, current.stagePath, current, plan.onRead)
    : []);
  if (JSON.stringify(actual) !== JSON.stringify(plan.journal.provenance)) {
    throw new Error('Staged durable evidence does not match migration provenance');
  }
}

function retireEvidence(plan, id) {
  const current = item(plan, id);
  if (current.present) fs.renameSync(current.sourcePath, current.backupPath);
}

function restoreEvidence(plan, id) {
  const current = item(plan, id);
  if (lstat(current.backupPath)) fs.renameSync(current.backupPath, current.sourcePath);
}

function prepareDestinationRoot(plan) {
  if (!plan.items.some(({ present }) => present)) return;
  const stat = lstat(plan.destinationRoot);
  if (stat && !stat.isDirectory()) throw new Error(`Unknown docs root: ${plan.destinationRoot}`);
  if (!stat) {
    fs.mkdirSync(plan.destinationRoot);
    plan.destinationRootCreated = true;
  }
}

function restoreDestinationRoot(plan) {
  if (plan.destinationRootCreated) fs.rmdirSync(plan.destinationRoot);
}

function publishEvidence(plan, id) {
  const current = item(plan, id);
  if (current.present) fs.renameSync(current.stagePath, current.destinationPath);
}

function removePublishedEvidence(plan, id) {
  fs.rmSync(item(plan, id).destinationPath, { recursive: true, force: true });
}

function stageMigrationData(_scope, outerPlan, _journal, edge) {
  const plan = outerPlan.data;
  evidenceEdge(plan, edge, 'stage-postmortems', 'postmortems',
    stageEvidence, removeStagedEvidence);
  evidenceEdge(plan, edge, 'stage-research', 'research',
    stageEvidence, removeStagedEvidence);
  verifyStagedEvidence(plan);
}

function retireEvidenceSet(plan, edge) {
  evidenceEdge(plan, edge, 'retire-postmortems', 'postmortems', retireEvidence, restoreEvidence);
  evidenceEdge(plan, edge, 'retire-research', 'research', retireEvidence, restoreEvidence);
}

function publishEvidenceSet(plan, edge) {
  edge('prepare-docs', () => prepareDestinationRoot(plan),
    plan.destinationRootWillCreate ? () => restoreDestinationRoot(plan) : undefined);
  evidenceEdge(plan, edge, 'publish-postmortems', 'postmortems',
    publishEvidence, removePublishedEvidence);
  evidenceEdge(plan, edge, 'publish-research', 'research',
    publishEvidence, removePublishedEvidence);
}

function verifyCommittedData(plan) {
  validateCommittedData(plan.root, plan.journal, plan.onRead);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validDataJournal(journal) {
  if (!exactKeys(journal, ['roots', 'provenance', 'externalReferences', 'fullyClean'])
    || !Array.isArray(journal.roots) || !Array.isArray(journal.provenance)
    || !Array.isArray(journal.externalReferences)
    || typeof journal.fullyClean !== 'boolean') return false;
  const validRoots = journal.roots.length === EVIDENCE.length && journal.roots.every((record, index) => (
    exactKeys(record, ['source', 'destination', 'outcome'])
    && record.source === EVIDENCE[index].source
    && record.destination === EVIDENCE[index].destination
    && ['migrated', 'absent'].includes(record.outcome)
  ));
  const validProvenance = journal.provenance.every((record) => {
    const keys = ['source', 'destination', 'type', 'mode'];
    if (record.type === 'file') keys.push('sha256');
    return exactKeys(record, keys) && ['file', 'directory'].includes(record.type)
      && Number.isInteger(record.mode) && typeof record.source === 'string'
      && typeof record.destination === 'string'
      && (record.type !== 'file' || /^[a-f0-9]{64}$/.test(record.sha256));
  });
  const validReferences = journal.externalReferences.every((record) => (
    exactKeys(record, ['path', 'evidenceGap', 'nextOwner'])
    && typeof record.path === 'string'
    && record.evidenceGap === 'manifest-external legacy reference'
    && record.nextOwner === 'root operator'
  ));
  return validRoots && validProvenance && validReferences;
}

function validateCommittedData(root, journal, onRead) {
  if (!validDataJournal(journal)) {
    throw new Error('Migration durable-data evidence is invalid');
  }
  if (journal.fullyClean !== (journal.externalReferences.length === 0)) {
    throw new Error('Migration external-reference verdict is inconsistent');
  }
  const actual = EVIDENCE.flatMap((definition, index) => {
    const source = dataPath(root, definition.source);
    const destination = dataPath(root, definition.destination);
    if (journal.roots[index].outcome === 'absent') {
      if (lstat(source)) throw new Error(`Unexpected durable evidence source: ${definition.source}`);
      return [];
    }
    if (lstat(source)) {
      throw new Error(`Migrated durable evidence source remains: ${definition.source}`);
    }
    if (!lstat(destination)?.isDirectory()) {
      throw new Error(`Migrated durable evidence destination is missing: ${definition.destination}`);
    }
    return evidenceRecords(root, destination, definition, onRead);
  });
  if (JSON.stringify(actual) !== JSON.stringify(journal.provenance)) {
    throw new Error('Migrated durable evidence does not match provenance');
  }
}

module.exports = {
  planDataMigration,
  publishEvidenceSet,
  retireEvidenceSet,
  stageMigrationData,
  validateCommittedData,
  verifyCommittedData,
  verifyStagedEvidence
};
