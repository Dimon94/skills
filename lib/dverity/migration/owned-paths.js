const fs = require('fs');
const path = require('path');
const { safePath } = require('./managed-path');

function directoryState(root, relatives) {
  return relatives.map((relative) => {
    const target = safePath(root, relative);
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isDirectory()) throw new Error(`Owned path parent is not a directory: ${target}`);
      return { relative, existed: true, mode: stat.mode & 0o7777 };
    } catch (error) {
      if (error.code === 'ENOENT') return { relative, existed: false, mode: null };
      throw error;
    }
  });
}

function deepestFirst(states) {
  return [...states].sort((left, right) => (
    right.relative.split('/').length - left.relative.split('/').length
  ));
}

function ensureDirectories(root, states) {
  for (const state of [...states].reverse()) {
    const target = safePath(root, state.relative);
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    if (state.existed) fs.chmodSync(target, state.mode);
  }
}

function pruneDirectories(root, states, predicate) {
  for (const state of deepestFirst(states).filter(predicate)) {
    try {
      fs.rmdirSync(safePath(root, state.relative));
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    }
  }
}

function copyOwnedPath(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let created = false;
  try {
    if (stat.isDirectory()) {
      fs.mkdirSync(destination, { mode: stat.mode & 0o7777 });
      created = true;
      for (const entry of fs.readdirSync(source)) {
        copyOwnedPath(path.join(source, entry), path.join(destination, entry));
      }
      fs.chmodSync(destination, stat.mode & 0o7777);
      return;
    }
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    created = true;
    fs.chmodSync(destination, stat.mode & 0o7777);
  } catch (error) {
    if (created) fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

function sameOwnedPath(source, destination) {
  const sourceStat = fs.lstatSync(source);
  const destinationStat = fs.lstatSync(destination);
  if ((sourceStat.mode & 0o7777) !== (destinationStat.mode & 0o7777)) return false;
  if (sourceStat.isFile()) {
    return destinationStat.isFile()
      && fs.readFileSync(source).equals(fs.readFileSync(destination));
  }
  if (!sourceStat.isDirectory() || !destinationStat.isDirectory()) return false;
  const sourceEntries = fs.readdirSync(source).sort();
  const destinationEntries = fs.readdirSync(destination).sort();
  return JSON.stringify(sourceEntries) === JSON.stringify(destinationEntries)
    && sourceEntries.every((entry) => sameOwnedPath(
      path.join(source, entry),
      path.join(destination, entry)
    ));
}

function cleanupCopied(pairs) {
  for (const { destination } of [...pairs].reverse()) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
}

function restoreOwnedPath(source, destination) {
  let destinationStat;
  try {
    destinationStat = fs.lstatSync(destination);
  } catch (error) {
    if (error.code === 'ENOENT') return copyOwnedPath(source, destination);
    throw error;
  }
  const sourceStat = fs.lstatSync(source);
  if (sourceStat.isSymbolicLink() || destinationStat.isSymbolicLink()) {
    throw new Error(`Symlink is not allowed: ${destination}`);
  }
  if (sourceStat.isFile()) {
    if (!destinationStat.isFile()
      || !fs.readFileSync(source).equals(fs.readFileSync(destination))) {
      throw new Error(`Owned migration recovery collision: ${destination}`);
    }
    fs.chmodSync(destination, sourceStat.mode & 0o7777);
    return;
  }
  if (!sourceStat.isDirectory() || !destinationStat.isDirectory()) {
    throw new Error(`Owned migration recovery collision: ${destination}`);
  }
  const sourceEntries = fs.readdirSync(source).sort();
  const destinationEntries = fs.readdirSync(destination).sort();
  if (destinationEntries.some((entry) => !sourceEntries.includes(entry))) {
    throw new Error(`Owned migration recovery collision: ${destination}`);
  }
  for (const entry of sourceEntries) {
    restoreOwnedPath(path.join(source, entry), path.join(destination, entry));
  }
  fs.chmodSync(destination, sourceStat.mode & 0o7777);
}

function movePairs(pairs) {
  const copied = [];
  try {
    for (const pair of pairs) {
      copyOwnedPath(pair.source, pair.destination);
      copied.push(pair);
    }
  } catch (error) {
    cleanupCopied(copied);
    throw error;
  }
  const clearing = [];
  try {
    for (const pair of pairs) {
      if (!sameOwnedPath(pair.source, pair.destination)) {
        throw new Error(`Owned migration copy verification failed: ${pair.source}`);
      }
      clearing.push(pair);
      fs.rmSync(pair.source, { recursive: true });
    }
  } catch (error) {
    try {
      for (const pair of [...clearing].reverse()) {
        restoreOwnedPath(pair.destination, pair.source);
      }
      cleanupCopied(copied);
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], 'Owned migration source recovery failed');
    }
    throw error;
  }
}

function createOwnedTransfer({ sourceRoot, destinationRoot, paths,
  pruneSource = [], cleanupDestination = [] }) {
  return {
    sourceRoot,
    destinationRoot,
    paths: [...paths],
    sourceDirectories: directoryState(sourceRoot, pruneSource),
    destinationDirectories: directoryState(destinationRoot, cleanupDestination)
  };
}

function skillPaths(projection, skills) {
  return skills.map((skill) => `${projection}/${skill}`);
}

function projectionTransfer(sourceRoot, destinationRoot, projection, skills, options) {
  return createOwnedTransfer({
    sourceRoot,
    destinationRoot,
    paths: skillPaths(projection, skills),
    ...options
  });
}

function legacyCodexTransfer(root, backupRoot, skills, marker) {
  return createOwnedTransfer({
    sourceRoot: root,
    destinationRoot: backupRoot,
    paths: [marker, ...skillPaths('.codex/skills', skills)],
    pruneSource: ['.codex', '.codex/skills']
  });
}

function createMigrationTransfers(input) {
  const { root, backupRoot, stageRoot, legacySkills, dveritySkills, legacyMarkerPath } = input;
  return {
    legacyCodex: legacyCodexTransfer(root, backupRoot, legacySkills, legacyMarkerPath),
    legacyClaude: projectionTransfer(root, backupRoot, '.claude/skills', legacySkills, {
      pruneSource: ['.claude', '.claude/skills']
    }),
    publishAgents: projectionTransfer(stageRoot, root, '.agents/skills', dveritySkills, {
      cleanupDestination: ['.agents', '.agents/skills']
    }),
    publishClaude: projectionTransfer(stageRoot, root, '.claude/skills', dveritySkills, {
      cleanupDestination: ['.claude', '.claude/skills']
    })
  };
}

function transferPairs(transfer) {
  return transfer.paths.map((relative) => ({
    source: safePath(transfer.sourceRoot, relative),
    destination: safePath(transfer.destinationRoot, relative)
  }));
}

function forwardOwnedTransfer(transfer) {
  const pairs = transferPairs(transfer);
  let transferred = false;
  try {
    ensureDirectories(transfer.destinationRoot, transfer.destinationDirectories);
    movePairs(pairs);
    transferred = true;
    pruneDirectories(transfer.sourceRoot, transfer.sourceDirectories, () => true);
  } catch (error) {
    if (transferred) {
      ensureDirectories(transfer.sourceRoot, transfer.sourceDirectories);
      movePairs(pairs.reverse().map(({ source, destination }) => ({
        source: destination,
        destination: source
      })));
    }
    pruneDirectories(transfer.destinationRoot, transfer.destinationDirectories,
      ({ existed }) => !existed);
    throw error;
  }
}

function reverseOwnedTransfer(transfer) {
  ensureDirectories(transfer.sourceRoot, transfer.sourceDirectories);
  movePairs(transferPairs(transfer).reverse().map(({ source, destination }) => ({
    source: destination,
    destination: source
  })));
  pruneDirectories(transfer.destinationRoot, transfer.destinationDirectories,
    ({ existed }) => !existed);
}

module.exports = {
  createMigrationTransfers,
  forwardOwnedTransfer,
  reverseOwnedTransfer
};
