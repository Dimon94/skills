#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildSkillProvenance,
  validateSkillProvenance
} = require('../lib/dverity/install/skill-source');
const {
  classifyLegacySurface,
  legacyRuntimeViolations
} = require('../lib/dverity/legacy/classifier');
const {
  validateCurrentSurface
} = require('../lib/dverity/docs/current-surface');
const { isHistoryInputPath } = require('../lib/dverity/install/skill-source');

const ROOT = path.resolve(__dirname, '..');
const CURRENT_SURFACE_BASE = 'c3ce31c8b08f6480bf18a76dd69ff6f61de55a4f';
const EXPECTED_FILES = [
  'DVERITY.md',
  'bin/dverity.js',
  'bin/dverity-cli.js',
  'config/managed-downstreams.json',
  'lib/dverity/downstream-sync/index.js',
  'lib/dverity/review/git-source.js',
  'lib/dverity/install/host-discovery.js',
  'lib/dverity/install/host-projections.js',
  'lib/dverity/review/landing.js',
  'lib/dverity/legacy/classifier.js',
  'lib/dverity/install/lifecycle.js',
  'lib/dverity/migration/data.js',
  'lib/dverity/migration/managed-path.js',
  'lib/dverity/migration/owned-paths.js',
  'lib/dverity/migration/transaction-schema.json',
  'lib/dverity/review/merge.js',
  'lib/dverity/release/package-provenance.json',
  'lib/dverity/review/review-item-record.js',
  'lib/dverity/install/runtime-config.js',
  'lib/dverity/install/skill-source.js',
  'lib/dverity/review/submit.js',
  'scripts/verify-host-discovery.js',
  'skills/'
];

function validatePackageJson(errors) {
  const pkg = require(path.join(ROOT, 'package.json'));
  if (pkg.name !== 'dverity' || pkg.version !== '5.0.0') {
    errors.push('package identity must be dverity@5.0.0');
  }
  if (JSON.stringify(pkg.bin) !== JSON.stringify({ dverity: 'bin/dverity.js' })) {
    errors.push('package must publish only the dverity executable');
  }
  if (JSON.stringify(pkg.files) !== JSON.stringify(EXPECTED_FILES)) {
    errors.push('package files must contain only the Dverity runtime and root Skill source');
  }
}

function validateDveritySource(errors) {
  try {
    const result = validateSkillProvenance(buildSkillProvenance({ root: ROOT }));
    if (!result.success) errors.push(result.error);
  } catch (error) {
    errors.push(error.message);
  }
}

function validateLegacyRuntime(errors) {
  for (const candidate of legacyRuntimeViolations(classifyLegacySurface({ root: ROOT }))) {
    errors.push(`Active legacy ${candidate.type}: ${candidate.path}`);
  }
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: null });
  if (result.status !== 0) {
    throw new Error(Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)]).toString().trim());
  }
  return result.stdout;
}

function historyAt(ref) {
  const files = runGit(['ls-tree', '-r', '--name-only', ref]).toString()
    .split('\n').filter((rel) => rel && isHistoryInputPath(rel));
  return Object.fromEntries(files.map((rel) => [
    rel,
    crypto.createHash('sha256').update(runGit(['show', `${ref}:${rel}`])).digest('hex')
  ]));
}

function validateCurrentDocs(errors, packagedFiles) {
  try {
    const result = validateCurrentSurface({
      root: ROOT,
      history: historyAt(CURRENT_SURFACE_BASE),
      packagedFiles
    });
    errors.push(...result.errors);
  } catch (error) {
    errors.push(`Current-surface validation failed: ${error.message}`);
  }
}

function validatePackSmoke(errors) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-pack-'));
  try {
    const result = spawnSync('npm', ['pack', '--json', '--pack-destination', root], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      errors.push(`npm pack failed:\n${result.stdout}${result.stderr}`);
      return [];
    }
    try {
      return JSON.parse(result.stdout)[0].files.map(({ path: file }) => file);
    } catch (error) {
      errors.push(`npm pack inventory unreadable: ${error.message}`);
      return [];
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const errors = [];
  validatePackageJson(errors);
  validateDveritySource(errors);
  validateLegacyRuntime(errors);
  const packagedFiles = validatePackSmoke(errors);
  validateCurrentDocs(errors, packagedFiles);
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('validate-publish: ok');
}

if (require.main === module) main();

module.exports = {
  validateDveritySource,
  validateLegacyRuntime,
  validatePackageJson,
  validatePackSmoke,
  validateCurrentDocs
};
