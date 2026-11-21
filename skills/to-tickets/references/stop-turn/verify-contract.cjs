const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const examples = require('./briefs.cjs');

const root = __dirname;
const base = 'fixture-base';
const groups = examples(base);
const allSlices = groups.split;
const covered = new Set(allSlices.flatMap(slice => slice.owns));

assert.equal(groups.single.length, 1, '正例：简单票只有一份派发合同');
assert.deepEqual(groups.single[0].scenarios, ['S1'], '正例：合同保留原场景');
assert.deepEqual([...covered].sort(), ['R1', 'T1'], '正例：两片合计覆盖 T1 与 R1');
assert.notDeepEqual(allSlices[0].writable, allSlices[1].writable, '正例：两片写入范围可隔离');
assert.equal(groups.missingResult.length, 2, '反例：缺失覆盖仍保留两份片合同');
assert.deepEqual([...new Set(groups.missingResult.flatMap(slice => slice.owns))], ['T1'], '反例：两片都漏掉 R1');

const weakTicket = fs.readFileSync(path.join(root, 'ticket-missing-result.md'), 'utf8');
const completeTicket = fs.readFileSync(path.join(root, 'ticket.md'), 'utf8');
assert.notEqual(weakTicket, completeTicket, '反例：票面确实删掉了部分结果');
assert.match(completeTicket, /仍可读到「第一段」/);
assert.doesNotMatch(weakTicket, /仍可读到「第一段」/);

const check = path.join(root, 'example', 'check.cjs');
for (const scope of ['status', 'results', 'all']) {
  assert.throws(
    () => execFileSync(process.execPath, [check, scope], { stdio: 'pipe' }),
    error => error.status === 1,
    `未实现夹具应在 ${scope} 入口报红`,
  );
}

const { prepare } = require('../../../delegate-ticket/scripts/prepare.js');
const { implement } = require('../../../implement/scripts/implement.js');
assert.throws(() => prepare({ id: 'TURN-1' }, [], base), error => error.code === 'ERR_NOT_IMPLEMENTED');
assert.throws(() => implement({ ticket: 'TURN-1' }), error => error.code === 'ERR_NOT_IMPLEMENTED');

console.log('A01 contract fixture ok');
