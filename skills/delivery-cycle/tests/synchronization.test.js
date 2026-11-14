/**
 * 逐项写入与回读：T4、T5、T6、T10、R7、R10、R11、R13。
 * 期望值来源：Spec T 覆盖表与第 6 节稳定结果表；周边界手算见 fake-adapters.js。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintainCurrentWeek } from '../scripts/delivery-cycle.js';
import { FakeEvidence, FakeLinear, REQUEST, TUESDAY, WEEK, portError } from './fake-adapters.js';

const run = (linear, now = TUESDAY) => maintainCurrentWeek(REQUEST, { linear, evidence: new FakeEvidence(), now });

function twoMMFs() {
  return new FakeLinear().add({ id: 'P1', specRef: 'spec-1' }).add({ id: 'P2', specRef: 'spec-2' });
}

test('T4/R7：patch 只含 cycle；无关标签、状态、父子、branch、Issue 数不变', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P1', specRef: 'spec-1', statusType: 'backlog', labels: ['keep'], branch: 'b1' })
    .add({ id: 'T1', parentId: 'P1', labels: ['x', 'y'], branch: 'b2' });
  const before = linear.snapshot();
  const result = await run(linear);

  assert.equal(result.status, 'synchronized');
  assert.ok(linear.mutations.every((m) => JSON.stringify(Object.keys(m.patch)) === '["cycle"]'));
  const after = linear.snapshot();
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map(({ cycleId, ...rest }) => rest), before.map(({ cycleId, ...rest }) => rest));
  assert.deepEqual(after.map((i) => i.cycleId), ['cycle-1', 'cycle-1']);
});

test('T6：changed 只计回读确认的变更', async () => {
  const linear = twoMMFs().add({ id: 'P3', specRef: 'spec-3', cycleId: 'cycle-1' });
  const result = await run(linear);
  assert.equal(result.status, 'synchronized');
  assert.equal(result.changed, 2);
  assert.deepEqual(result.items.map((i) => [i.issueId, i.write]),
    [['P1', 'verified'], ['P2', 'verified'], ['P3', 'unchanged']]);
});

test('T6/R10：mutation 返回成功但业务字段不符 → readback_mismatch，不计 changed', async () => {
  const linear = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' });
  linear.patchBehavior = async () => ({ success: true }); // HTTP 200，但不生效
  const result = await run(linear);

  assert.equal(result.status, 'unsynchronized');
  assert.equal(result.changed, 0);
  assert.deepEqual(result.problems.map((p) => [p.code, p.issueId]), [['readback_mismatch', 'P1']]);
});

test('R10：写入抛错且回读不符 → write_unknown；权限拒绝 → permission_denied', async () => {
  const unknown = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' });
  unknown.patchBehavior = async () => { throw new Error('timeout'); };
  const r1 = await run(unknown);
  assert.equal(r1.status, 'unknown');
  assert.equal(r1.problems[0].code, 'write_unknown');

  const denied = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' });
  denied.patchBehavior = async () => { throw portError('permission_denied'); };
  const r2 = await run(denied);
  assert.equal(r2.status, 'unsynchronized');
  assert.equal(r2.problems[0].code, 'permission_denied');
});

test('R10：一项成功一项失败 → partial，成功项不回滚', async () => {
  const linear = twoMMFs();
  linear.patchBehavior = async (id, patch, apply) => { if (id === 'P1') apply(); return { success: true }; };
  const result = await run(linear);

  assert.equal(result.status, 'partial');
  assert.equal(result.changed, 1);
  assert.equal(linear.issues.get('P1').cycleId, 'cycle-1');
});

test('T5/R8：第二项前读前已被原生滚动加入 → 采用最新事实，不再写', async () => {
  const linear = twoMMFs();
  linear.beforeRead = (id) => { if (id === 'P2') linear.issues.get('P2').cycleId = 'cycle-1'; };
  const result = await run(linear);

  assert.equal(result.status, 'synchronized');
  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1']);
  assert.equal(result.items.find((i) => i.issueId === 'P2').write, 'unchanged');
});

test('T5/R8：运行途中跨过上海周一 → cycle_expired，停止旧周后续写入', async () => {
  const linear = twoMMFs();
  const times = [new Date('2026-11-22T15:59:00Z'), new Date('2026-11-22T15:59:30Z'), new Date(WEEK.end)];
  const result = await run(linear, () => times.shift() ?? new Date(WEEK.end));

  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1']);
  assert.equal(linear.issues.get('P2').cycleId, null);
  assert.equal(result.status, 'partial');
  assert.ok(result.problems.some((p) => p.code === 'cycle_expired'));
});

test('T5：第一项前即跨周 → unsynchronized 且零写入', async () => {
  const linear = twoMMFs();
  const times = [new Date('2026-11-22T15:59:00Z')];
  const result = await run(linear, () => times.shift() ?? new Date(WEEK.end));
  assert.equal(result.status, 'unsynchronized');
  assert.equal(linear.mutations.length, 0);
});

test('T10/R11：同一实际状态重复执行，第二次 changed=0、unchanged、零 mutation', async () => {
  const linear = twoMMFs();
  const first = await run(linear);
  assert.equal(first.changed, 2);
  const count = linear.mutations.length;
  const before = linear.snapshot();

  const second = await run(linear);
  assert.equal(second.status, 'synchronized');
  assert.equal(second.changed, 0);
  assert.ok(second.items.every((i) => i.write === 'unchanged'));
  assert.equal(linear.mutations.length, count);
  assert.deepEqual(linear.snapshot(), before);
});

test('T10：从已同步状态再次调用，实际被他人移出后重新核对并补写', async () => {
  const linear = twoMMFs();
  await run(linear);
  linear.issues.get('P2').cycleId = null;
  const again = await run(linear);
  assert.equal(again.changed, 1);
  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1', 'P2', 'P2']);
});

test('R13：维护只调用读方法与 patchIssue', async () => {
  const linear = twoMMFs();
  await run(linear);
  const allowed = new Set(['readCycleConfiguration', 'listCycles', 'readLabel', 'listIssues', 'readIssue', 'patchIssue']);
  assert.ok(linear.calls.every((c) => allowed.has(c)));
});
