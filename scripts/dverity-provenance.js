#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'lib/dverity/package-provenance.json');

function sourceCommit() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    throw new Error('Package provenance requires the Dverity source repository');
  }
  const result = spawnSync('git', ['rev-parse', '--show-toplevel', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const [topLevel, commit] = result.stdout.trim().split('\n');
  if (result.status !== 0 || fs.realpathSync(topLevel) !== fs.realpathSync(ROOT)
    || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Unable to bind package provenance to the Dverity source commit');
  }
  return commit;
}

function prepare() {
  const provenance = { schema_version: 1, source_commit: sourceCommit() };
  fs.writeFileSync(TARGET, `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' });
}

function clean() {
  fs.rmSync(TARGET, { force: true });
}

const ACTIONS = { prepare, clean };
const action = ACTIONS[process.argv[2]] || (() => {
  throw new Error('Usage: dverity-provenance.js prepare|clean');
});
action();
