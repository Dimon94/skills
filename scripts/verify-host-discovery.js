#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runHostDiscovery } = require('../lib/dverity/host-discovery');
const {
  inspectFreshHostRoot,
  inspectHostProjections
} = require('../lib/dverity/host-projections');

const ROOT = path.resolve(__dirname, '..');
const HOSTS = Object.freeze(['agents', 'claude']);

function selectedHosts(args) {
  if (args.length === 0) return HOSTS;
  if (args.length !== 2 || args[0] !== '--host' || !HOSTS.includes(args[1])) {
    throw new Error('Usage: verify-host-discovery.js [--host agents|claude]');
  }
  return [args[1]];
}

function install(root) {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'bin/dverity.js'), 'install', '--project', root
  ], { cwd: ROOT, encoding: 'utf8', input: '' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Artifact install failed');
}

function manifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.dverity/managed-skills.json'), 'utf8'));
}

function projectionInput(root, ownership) {
  return {
    artifactRoot: ROOT,
    installRoot: root,
    projections: ownership.projections.map(({ root: projection }) => projection),
    files: ownership.projections[0].files.map((file) => ({
      ...file,
      packagePath: `skills/${file.path}`
    }))
  };
}

function verify(host) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `dverity-${host}-`)));
  try {
    install(root);
    const ownership = manifest(root);
    inspectFreshHostRoot(root);
    inspectHostProjections(projectionInput(root, ownership));
    return runHostDiscovery({ host, installRoot: root, manifest: ownership });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(args = process.argv.slice(2)) {
  const results = selectedHosts(args).map(verify);
  for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`);
  if (results.some((result) => result.status === 'fail')) return 1;
  if (results.some((result) => result.status === 'blocked')) return 2;
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 3;
}
