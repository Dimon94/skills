#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { auditArtifactFreeze } = require('../lib/dverity/release/release-readiness');
const {
  RELEASE_PROVENANCE,
  collectReleaseProvenance
} = require('../lib/dverity/release/provenance');
const {
  freezeArtifact
} = require('./freeze-release-readiness');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_REPOSITORY = RELEASE_PROVENANCE.repository;
const EXPECTED_PACKAGE_REPOSITORY = 'git+https://github.com/Dimon94/dverity.git';
const RELEASE_ROOT = path.join(ROOT, 'dist/release-readiness');

function digest(bytes, encoding = 'hex') {
  return crypto.createHash('sha512').update(bytes).digest(encoding);
}

function command(commandName, args, { env = process.env } = {}) {
  const result = spawnSync(commandName, args, { cwd: ROOT, encoding: 'utf8', env });
  if (result.status !== 0) throw new Error(`${commandName} ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch`);
}

function withoutNodeAuth(env) {
  const safe = { ...env };
  delete safe.NODE_AUTH_TOKEN;
  return safe;
}

function publishEnvironment(env) {
  const publish = { ...env };
  delete publish.GH_TOKEN;
  delete publish.GITHUB_TOKEN;
  return publish;
}

function safeRunner(run, env) {
  const safeEnv = withoutNodeAuth(env);
  return (commandName, args) => run(commandName, args, { env: safeEnv });
}

function metadataPathFor(commit) {
  return path.join(RELEASE_ROOT, commit, 'artifact-freeze.json');
}

function assertWorkflowContext(env, run) {
  requireEqual(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'event');
  requireEqual(env.GITHUB_REPOSITORY, EXPECTED_REPOSITORY, 'repository');
  requireEqual(env.GITHUB_REF, 'refs/heads/main', 'ref');
  if (!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('selected commit is invalid');
  requireEqual(run('gh', ['api', `repos/${EXPECTED_REPOSITORY}`, '--jq', '.default_branch']), 'main', 'default branch');
  requireEqual(run('git', ['rev-parse', 'origin/main']), env.GITHUB_SHA, 'canonical main head');
}

function resolveFrozenSource({ env = process.env, run = command } = {}) {
  assertWorkflowContext(env, run);
  const provenance = collectReleaseProvenance({ run });
  requireEqual(env.GITHUB_SHA, provenance.main.merge, 'selected release main');
  const liveMain = run('gh', ['api', `repos/${EXPECTED_REPOSITORY}/git/ref/heads/main`, '--jq', '.object.sha']);
  if (!/^[a-f0-9]{40}$/.test(liveMain)) throw new Error('provider live main is malformed');
  requireEqual(liveMain, env.GITHUB_SHA, 'provider live main');
  return provenance.main.source;
}

function assertFrozenCheckout(source, run) {
  requireEqual(run('git', ['rev-parse', 'HEAD']), source, 'frozen source checkout');
  requireEqual(run('git', ['status', '--porcelain=v1', '--untracked-files=all']), '', 'source cleanliness');
}

function assertPackage(tarball, run) {
  const manifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']));
  requireEqual(manifest.name, 'dverity', 'package name');
  requireEqual(manifest.version, '5.0.0', 'package version');
  requireEqual(manifest.repository?.url, EXPECTED_PACKAGE_REPOSITORY, 'package repository');
}

function publishFrozen({ metadataPath, env = process.env, run = command } = {}) {
  if (!(env.NODE_AUTH_TOKEN || '').trim()) throw new Error('NPM_TOKEN is required');
  const preflight = safeRunner(run, env);
  const source = resolveFrozenSource({ env, run: preflight });
  assertFrozenCheckout(source, preflight);
  const selectedMetadata = metadataPath || metadataPathFor(source);
  const record = JSON.parse(fs.readFileSync(selectedMetadata, 'utf8'));
  const audit = auditArtifactFreeze(record);
  if (!audit.success) throw new Error(audit.error);
  requireEqual(record.source_commit, source, 'frozen source commit');
  const tarball = path.resolve(record.artifact_paths[0]);
  if (path.extname(tarball) !== '.tgz' || !fs.statSync(tarball).isFile()) throw new Error('artifact must be one tgz file');
  if (path.dirname(tarball) !== path.dirname(path.resolve(selectedMetadata))) throw new Error('artifact must be beside frozen metadata');
  const bytes = fs.readFileSync(tarball);
  requireEqual(digest(bytes), record.sha512, 'artifact SHA-512');
  requireEqual(`sha512-${digest(bytes, 'base64')}`, record.npm_integrity, 'artifact integrity');
  assertPackage(tarball, preflight);
  run('npm', ['publish', tarball, '--access', 'public', '--tag', 'latest', '--provenance'], {
    env: publishEnvironment(env)
  });
}

function freeze({ env = process.env, run = command } = {}) {
  const preflight = safeRunner(run, env);
  const source = resolveFrozenSource({ env, run: preflight });
  assertFrozenCheckout(source, preflight);
  const output = path.dirname(metadataPathFor(source));
  fs.mkdirSync(output, { recursive: true });
  const artifact = freezeArtifact(output, source, { env: withoutNodeAuth(env) });
  requireEqual(preflight('git', ['status', '--porcelain=v1', '--untracked-files=all']), '', 'post-freeze cleanliness');
  fs.writeFileSync(metadataPathFor(source), `${JSON.stringify(artifact.record, null, 2)}\n`, { flag: 'wx' });
}

if (require.main === module) {
  try {
    if (process.argv[2] === 'resolve') process.stdout.write(`source_commit=${resolveFrozenSource()}\n`);
    else if (process.argv[2] === 'freeze') freeze();
    else if (process.argv[2] === 'publish') publishFrozen();
    else throw new Error('usage: publish-dverity.js resolve|freeze|publish');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { freeze, metadataPathFor, publishFrozen, resolveFrozenSource };
