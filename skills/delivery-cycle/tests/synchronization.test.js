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
  let at = '2026-11-22T15:59:00Z'; // 上海周日 23:59；P2 前读时到达下一周一 00:00
  linear.beforeRead = (id) => { if (id === 'P2') at = WEEK.end; };
  const result = await run(linear, () => new Date(at));

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

// --------------------------------------------------------------------------
// 跨周交错（DD-545）：原生滚动与周一边界在维护前／中／后发生
// 手算：上海 2026-11-15 周日 23:59:59 = 2026-11-15T15:59:59Z，属旧周 cycle-0；
//       WEEK.start = 2026-11-15T16:00:00Z 是上海 11-16 周一 00:00，属新周 cycle-1
// --------------------------------------------------------------------------

const CROSS = [
  { id: 'cycle-0', startsAt: '2026-11-08T16:00:00.000Z', endsAt: WEEK.start },
  { id: 'cycle-1', startsAt: WEEK.start, endsAt: WEEK.end }
];
const SUNDAY_LATE = '2026-11-15T15:59:59.000Z';

function crossWeek(...issues) {
  const linear = issues.reduce((l, i) => l.add({ specRef: `spec-${i.id}`, ...i }), new FakeLinear({ cycles: CROSS }));
  const clock = { at: SUNDAY_LATE };
  return { linear, clock, now: () => new Date(clock.at) };
}
const codesOf = (result) => result.problems.map((p) => [p.code, p.issueId]);

test('R8：前读已观察到原生滚入新周（本地时钟仍在旧周）→ 不回移旧周，cycle_expired 停止', async () => {
  const { linear, now } = crossWeek({ id: 'P1' }, { id: 'P2', cycleId: 'cycle-0' });
  let rolled = false;
  linear.beforeRead = (id) => {
    if (id === 'P2' && !rolled) { rolled = true; linear.nativeRoll('cycle-0', 'cycle-1'); }
  };
  const result = await run(linear, now);

  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1']);
  assert.deepEqual(['P1', 'P2'].map((id) => linear.issues.get(id).cycleId), ['cycle-1', 'cycle-1']);
  assert.deepEqual(codesOf(result), [['cycle_expired', 'P2']]);
  assert.equal(result.status, 'partial');
});

test('R8/T5：前读在旧周、写入前已跨周一 → 零写入，不写旧周 Cycle', async () => {
  const { linear, clock, now } = crossWeek({ id: 'P1' });
  linear.beforeRead = () => { clock.at = WEEK.start; };
  const result = await run(linear, now);

  assert.equal(linear.mutations.length, 0);
  assert.equal(linear.issues.get('P1').cycleId, null);
  assert.equal(result.status, 'unsynchronized');
  assert.deepEqual(codesOf(result), [['cycle_expired', 'P1']]);
});

test('R8：写入后原生把项滚入新周 → 回读不符不算成功，停止后续旧周写入', async () => {
  const { linear, now } = crossWeek({ id: 'P1' }, { id: 'P2' });
  linear.patchBehavior = async (id, patch, apply) => {
    apply();
    linear.nativeRoll('cycle-0', 'cycle-1');
    return { success: true };
  };
  const result = await run(linear, now);

  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1']);
  assert.deepEqual(['P1', 'P2'].map((id) => linear.issues.get(id).cycleId), ['cycle-1', null]);
  assert.equal(result.items.find((i) => i.issueId === 'P1').write, 'failed');
  assert.equal(result.changed, 0);
  assert.equal(result.status, 'unsynchronized');
});

test('R8/R11：回读时已跨周一 → 旧周写入不算成功；新周首次调用按新周计划且收敛', async () => {
  const { linear, clock, now } = crossWeek({ id: 'P1' }, { id: 'P2' }, { id: 'P3', cycleId: 'cycle-0' });
  linear.patchBehavior = async (id, patch, apply) => {
    clock.at = WEEK.start;
    linear.nativeRoll('cycle-0', 'cycle-1'); // 周一原生滚动先发生，P1 的旧周写入后到
    apply();
    return { success: true };
  };
  const first = await run(linear, now);
  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1']);
  assert.equal(first.items.find((i) => i.issueId === 'P1').write, 'failed');
  assert.deepEqual(codesOf(first), [['cycle_expired', 'P1']]);
  assert.equal(first.status, 'unsynchronized');

  linear.patchBehavior = null;
  linear.mutations = [];
  clock.at = '2026-11-15T16:05:00.000Z'; // 上海周一 00:05
  const second = await run(linear, now);
  assert.equal(second.status, 'synchronized');
  assert.deepEqual(second.items.map((i) => [i.issueId, i.action, i.write]),
    [['P1', 'carry', 'verified'], ['P2', 'include', 'verified'], ['P3', 'include', 'unchanged']]);
  assert.ok(linear.mutations.every((m) => m.patch.cycle === 'cycle-1'), '新周调用不写旧周 Cycle');

  const third = await run(linear, now);
  assert.equal(third.changed, 0);
  assert.equal(linear.mutations.length, 2);
});
