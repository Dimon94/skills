#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildSkillProvenance,
  validateSkillProvenance
} = require('../lib/dverity/skill-source');
const {
  classifyLegacySurface,
  legacyRuntimeViolations
} = require('../lib/dverity/legacy/classifier');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_FILES = [
  'DVERITY.md',
  'bin/dverity.js',
  'bin/dverity-cli.js',
  'config/managed-downstreams.json',
  'lib/dverity/downstream-sync/index.js',
  'lib/dverity/git-source.js',
  'lib/dverity/host-discovery.js',
  'lib/dverity/host-projections.js',
  'lib/dverity/landing.js',
  'lib/dverity/legacy/classifier.js',
  'lib/dverity/lifecycle.js',
  'lib/dverity/migration/data.js',
  'lib/dverity/migration/transaction-schema.json',
  'lib/dverity/merge.js',
  'lib/dverity/package-provenance.json',
  'lib/dverity/review-item-record.js',
  'lib/dverity/runtime-config.js',
  'lib/dverity/skill-source.js',
  'lib/dverity/submit.js',
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

function validatePackSmoke(errors) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-pack-'));
  try {
    const result = spawnSync('npm', ['pack', '--pack-destination', root], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    if (result.status !== 0) errors.push(`npm pack failed:\n${result.stdout}${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const errors = [];
  validatePackageJson(errors);
  validateDveritySource(errors);
  validateLegacyRuntime(errors);
  validatePackSmoke(errors);
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
  validatePackSmoke
};
