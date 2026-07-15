const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECTIONS = Object.freeze(['.agents/skills', '.claude/skills']);
const REMOVED_HOSTS = Object.freeze(['.codex', '.cursor', '.qwen', '.agent']);

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safeJoin(root, relative) {
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error(`Projection path escapes root: ${relative}`);
  return target;
}

function assertInputs({ artifactRoot, installRoot, files, projections }) {
  if (JSON.stringify(projections) !== JSON.stringify(PROJECTIONS)) {
    throw new Error('Dverity supports only .agents and .claude host projections');
  }
  const artifact = path.resolve(artifactRoot);
  const install = path.resolve(installRoot);
  if (projections.some((root) => inside(path.join(install, root), artifact))) {
    throw new Error('A host projection cannot become the artifact source');
  }
  if (!Array.isArray(files) || files.length === 0) throw new Error('Frozen artifact files are required');
}

function artifactFile(input, file) {
  const source = safeJoin(input.artifactRoot, file.packagePath);
  if (!fs.statSync(source).isFile() || sha256(fs.readFileSync(source)) !== file.sha256) {
    throw new Error(`Frozen artifact drift: ${file.packagePath}`);
  }
  return source;
}

function expectedFiles(input, projection) {
  return input.files.map((file) => ({
    ...file,
    target: safeJoin(input.installRoot, `${projection}/${file.path}`)
  }));
}

function skillFiles(input) {
  return input.files.filter((file) => {
    const relative = path.normalize(file.path);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`);
  });
}

function hostProjectionFiles(input) {
  return input.projections.flatMap((projection) => expectedFiles(input, projection));
}

function missingProjectionDirectories(input) {
  const root = path.resolve(input.installRoot);
  const directories = new Set();
  for (const file of hostProjectionFiles(input)) {
    for (let current = path.dirname(file.target); current !== root; current = path.dirname(current)) {
      if (!fs.existsSync(current)) directories.add(current);
    }
  }
  return [...directories].sort((left, right) => left.split(path.sep).length - right.split(path.sep).length);
}

function materializeHostProjections(input) {
  assertInputs(input);
  for (const projection of input.projections) {
    for (const file of expectedFiles(input, projection)) {
      const source = artifactFile(input, file);
      fs.mkdirSync(path.dirname(file.target), { recursive: true });
      fs.copyFileSync(source, file.target, fs.constants.COPYFILE_EXCL);
    }
  }
}

function actualManagedFiles(input, projection) {
  const skills = new Set(skillFiles(input).map((file) => file.path.split('/')[0]));
  return [...skills].flatMap((skill) => {
    const root = safeJoin(input.installRoot, `${projection}/${skill}`);
    if (!fs.existsSync(root)) throw new Error(`${projection} missing managed Skill: ${skill}`);
    return walk(root).map((file) => path.relative(
      safeJoin(input.installRoot, projection),
      file
    ).split(path.sep).join('/'));
  }).sort();
}

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name)).flatMap((entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return walk(target);
      if (entry.isFile()) return [target];
      throw new Error(`Unknown managed projection entry: ${target}`);
    });
}

function hashProjectionTree(root, entries = fs.readdirSync(root).sort()) {
  const hash = crypto.createHash('sha256');
  const files = entries.flatMap((entry) => walk(path.join(root, entry)));
  for (const file of files) {
    hash.update(path.relative(root, file).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function treeHash(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function inspectHostProjections(input) {
  assertInputs(input);
  const expected = skillFiles(input).map((file) => file.path).sort();
  const artifactFiles = input.files.map((file) => artifactFile(input, file));
  const projections = input.projections.map((root) => {
    const files = expectedFiles(input, root);
    if (JSON.stringify(actualManagedFiles(input, root)) !== JSON.stringify(expected)) {
      throw new Error(`${root} managed exact-set drift`);
    }
    for (const file of files) {
      if (!fs.existsSync(file.target) || sha256(fs.readFileSync(file.target)) !== file.sha256) {
        throw new Error(`${root} projection drift: ${file.path}`);
      }
    }
    return { root, file_count: files.length, hash: treeHash(files.map((file) => file.target)) };
  });
  return { artifact_hash: treeHash(artifactFiles), projections };
}

function inspectFreshHostRoot(installRoot) {
  for (const removed of REMOVED_HOSTS) {
    if (fs.existsSync(path.join(installRoot, removed))) {
      throw new Error(`Removed host output exists in fresh root: ${removed}`);
    }
  }
}

module.exports = {
  hashProjectionTree,
  hostProjectionFiles,
  inspectFreshHostRoot,
  inspectHostProjections,
  missingProjectionDirectories,
  materializeHostProjections
};
