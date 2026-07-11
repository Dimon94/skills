const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_PATHS = Object.freeze({
  user: '.dverity/config.yml',
  project: '.dverity/config.yml',
  local: '.dverity/config.local.yml'
});
const DOCUMENT_LANGUAGE_ENV = 'DVERITY_DOCUMENT_LANGUAGE';
const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  output: Object.freeze({ document_language: 'en' }),
  agent_preferences: Object.freeze({})
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertRuntimePath(root, target) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Dverity config path escapes its root: ${target}`);
  }
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (lstat(cursor)?.isSymbolicLink()) {
      throw new Error(`Dverity config path cannot contain a symlink: ${cursor}`);
    }
  }
  return target;
}

function runtimeConfigSources({ projectRoot, homeDir }) {
  return [
    { kind: 'user', root: homeDir, path: path.join(homeDir, CONFIG_PATHS.user) },
    { kind: 'project', root: projectRoot, path: path.join(projectRoot, CONFIG_PATHS.project) },
    { kind: 'local', root: projectRoot, path: path.join(projectRoot, CONFIG_PATHS.local) }
  ];
}

function merge(left, right) {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    result[key] = isObject(value) && isObject(left[key])
      ? merge(left[key], value)
      : value;
  }
  return result;
}

function readConfig(root, file, record) {
  assertRuntimePath(root, file);
  record({ kind: 'config', path: file });
  if (!fs.existsSync(file)) return null;
  const value = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  if (!isObject(value)) throw new Error(`Dverity config must be a YAML object: ${file}`);
  return value;
}

function validate(config, source) {
  const language = config.output?.document_language;
  if (language && !['en', 'zh-CN'].includes(language)) {
    throw new Error(`Unsupported output.document_language "${language}" in ${source}`);
  }
  if (config.agent_preferences && !isObject(config.agent_preferences)) {
    throw new Error(`agent_preferences must be an object in ${source}`);
  }
}

function resolveRuntimeConfig(options = {}) {
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const reads = [];
  const record = (entry) => {
    reads.push(entry);
    if (options.onRead) options.onRead(entry);
  };
  const sources = runtimeConfigSources({ projectRoot, homeDir });
  let config = merge({}, DEFAULT_CONFIG);
  const consumed = [];
  for (const { kind, root, path: file } of sources) {
    const value = readConfig(root, file, record);
    if (!value) continue;
    validate(value, file);
    config = merge(config, value);
    consumed.push({ kind, path: file });
  }
  record({ kind: 'env', key: DOCUMENT_LANGUAGE_ENV });
  const language = (options.env || process.env)[DOCUMENT_LANGUAGE_ENV];
  if (language) {
    config = merge(config, { output: { document_language: language } });
    consumed.push({ kind: 'env', key: DOCUMENT_LANGUAGE_ENV });
  }
  validate(config, 'resolved Dverity config');
  return { enabled: consumed.length > 0, config, sources: consumed, reads };
}

module.exports = {
  CONFIG_PATHS,
  DEFAULT_CONFIG,
  DOCUMENT_LANGUAGE_ENV,
  assertRuntimePath,
  runtimeConfigSources,
  resolveRuntimeConfig
};
