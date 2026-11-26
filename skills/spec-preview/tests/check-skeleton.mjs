import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { run } from 'node:test';
import { fileURLToPath } from 'node:url';

const testFile = name => fileURLToPath(new URL(name, import.meta.url));
const skeleton = spawnSync(process.execPath, ['--test', testFile('skeleton.test.mjs')], { encoding: 'utf8' });
assert.ifError(skeleton.error);
assert.equal(skeleton.status, 0, skeleton.stdout + skeleton.stderr);

const failedIds = [];
const expectedIds = Array.from({ length: 15 }, (_, index) => `S${index + 1}`);
const scenarios = run({ files: [testFile('scenarios.test.mjs')] });
for await (const event of scenarios) {
  if (event.type === 'test:pass') assert.fail(`场景应报红：${event.data.name}`);
  if (event.type !== 'test:fail') continue;
  const { name, details, todo } = event.data;
  assert.equal(todo, undefined, name);
  assert.equal(details.error.failureType, 'testCodeFailure', name);
  assert.equal(details.error.cause?.code, 'ERR_ASSERTION', name);
  failedIds.push(name.split(' ')[0]);
}
assert.deepEqual(failedIds, expectedIds);
console.log('skeleton ok');
