import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testFile = name => fileURLToPath(new URL(name, import.meta.url));
const skeleton = spawnSync(process.execPath, ['--test', testFile('skeleton.test.mjs')], { encoding: 'utf8' });
assert.ifError(skeleton.error);
assert.equal(skeleton.status, 0, skeleton.stdout + skeleton.stderr);

console.log('skeleton ok');
