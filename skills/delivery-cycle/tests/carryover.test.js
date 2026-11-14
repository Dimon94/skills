/**
 * 正式交付与跨周结转：R4、R5、R14、R15。
 * 期望值来源：Spec R4／R5／R14／R15、第 4 节结转规则、第 6 节结果表。
 * 时间手算：本周 = 上海 2026-11-16 周一 00:00 起 = [2026-11-15T16:00Z, 2026-11-22T16:00Z)；
 *          上周 Cycle = [2026-11-08T16:00Z, 2026-11-15T16:00Z)；now = 周二 18:00。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFormalDelivery, maintainCurrentWeek } from '../scripts/delivery-cycle.js';
import { FakeEvidence, FakeLinear, REQUEST, TUESDAY, WEEK } from './fake-adapters.js';

const CYCLES = [
  { id: 'cycle-old', startsAt: '2026-11-01T16:00:00.000Z', endsAt: '2026-11-08T16:00:00.000Z' },
  { id: 'cycle-0', startsAt: '2026-11-08T16:00:00.000Z', endsAt: WEEK.start },
  { id: 'cycle-1', startsAt: WEEK.start, endsAt: WEEK.end },
  { id: 'cycle-2', startsAt: WEEK.end, endsAt: '2026-11-29T16:00:00.000Z' },
  { id: 'cycle-3', startsAt: '2026-11-29T16:00:00.000Z', endsAt: '2026-12-06T16:00:00.000Z' }
];
const LAST_WEEK = '2026-11-12T03:00:00.000Z';
const THIS_WEEK = '2026-11-16T03:00:00.000Z';

const verified = (effectiveAt) => ({ state: 'verified', source: 'owner', effectiveAt, reason: null });
const delivered = (specAt, mainAt = specAt) => ({ spec: verified(specAt), main: verified(mainAt) });
const NOT_MET = { spec: verified(LAST_WEEK), main: { state: 'not_met', source: 'closeout', effectiveAt: null, reason: 'no merge' } };
const UNKNOWN = { spec: { state: 'unknown', source: null, effectiveAt: null, reason: 'missing' }, main: verified(LAST_WEEK) };

const linearWith = (...issues) => issues.reduce((l, i) => l.add(i), new FakeLinear({ cycles: CYCLES }));
const run = (linear, evidence) => maintainCurrentWeek(REQUEST, { linear, evidence, now: TUESDAY });
const item = (result, id) => result.items.find((i) => i.issueId === id);
const codes = (result, code) => result.problems.filter((p) => p.code === code).map((p) => p.issueId).sort();
const cycleOf = (linear, id) => linear.issues.get(id).cycleId;

test('R4：上周已交付不结转，原生滚入本周的归属纠正为 cycle=null 并回读；旧周历史不动', async () => {
  const linear = linearWith(
    { id: 'P1', specRef: 's1', statusType: 'completed', cycleId: 'cycle-1' },
    { id: 'P2', specRef: 's2', statusType: 'completed', cycleId: 'cycle-0' });
  const result = await run(linear, new FakeEvidence({ P1: delivered(LAST_WEEK), P2: delivered(LAST_WEEK) }));

  assert.equal(result.status, 'synchronized');
  assert.deepEqual(linear.mutations, [{ issueId: 'P1', patch: { cycle: null } }]);
  assert.equal(cycleOf(linear, 'P1'), null);
  assert.equal(cycleOf(linear, 'P2'), 'cycle-0');
  assert.deepEqual([item(result, 'P1').action, item(result, 'P1').write], ['not_carry', 'verified']);
  assert.deepEqual([item(result, 'P2').action, item(result, 'P2').write], ['not_carry', 'unchanged']);
  assert.equal(result.changed, 1);
});

test('R4/R14：上周合 main、本周才满足 Spec → effectiveAt 取较晚值，本周刚交付保留', async () => {
  const linear = linearWith({ id: 'P1', specRef: 's1', statusType: 'completed', cycleId: 'cycle-1' });
  const result = await run(linear, new FakeEvidence({ P1: delivered(THIS_WEEK, LAST_WEEK) }));

  assert.equal(item(result, 'P1').delivery.effectiveAt, THIS_WEEK);
  assert.equal(cycleOf(linear, 'P1'), 'cycle-1');
  assert.equal(linear.mutations.length, 0);
  assert.equal(result.status, 'synchronized');
});

test('R4：周一 00:30 交付归新周保留；周日 23:30 交付属上周、移出本周', async () => {
  const linear = linearWith(
    { id: 'MON', specRef: 's1', statusType: 'completed', cycleId: 'cycle-1' },
    { id: 'SUN', specRef: 's2', statusType: 'completed', cycleId: 'cycle-1' });
  const evidence = new FakeEvidence({
    MON: delivered('2026-11-15T16:30:00.000Z'),
    SUN: delivered('2026-11-15T15:30:00.000Z')
  });
  await run(linear, evidence);

  assert.equal(cycleOf(linear, 'MON'), 'cycle-1');
  assert.equal(cycleOf(linear, 'SUN'), null);
});

test('R14：已交付但缺 main 时间 → delivered、effectiveAt=null、delivery_time_unverifiable，保持原归属', async () => {
  const noTime = { spec: verified(THIS_WEEK), main: { ...verified(null), committedAt: THIS_WEEK } };
  const linear = linearWith(
    { id: 'P1', specRef: 's1', statusType: 'completed', cycleId: 'cycle-0' },
    { id: 'P2', specRef: 's2', cycleId: 'cycle-1' });
  const result = await run(linear, new FakeEvidence({ P1: noTime }));

  const p1 = item(result, 'P1');
  assert.deepEqual([p1.delivery.status, p1.delivery.effectiveAt], ['delivered', null]);
  assert.deepEqual([p1.action, p1.write], ['unchanged', 'unknown']);
  assert.equal(cycleOf(linear, 'P1'), 'cycle-0');
  assert.equal(linear.mutations.length, 0);
  assert.deepEqual(codes(result, 'delivery_time_unverifiable'), ['P1']);
  assert.equal(result.status, 'partial');

  const alone = linearWith({ id: 'P1', specRef: 's1', statusType: 'completed', cycleId: 'cycle-1' });
  assert.equal((await run(alone, new FakeEvidence({ P1: noTime }))).status, 'unknown');
});

test('R4：未交付与 Unknown 的上周原工作结转本周；已完成子票与未来 Cycle 不动', async () => {
  const linear = linearWith(
    { id: 'P1', specRef: 's1', statusType: 'started', cycleId: 'cycle-0' },
    { id: 'P2', specRef: 's2', statusType: 'unstarted', cycleId: 'cycle-0' },
    { id: 'T2', parentId: 'P2', statusType: 'unstarted', cycleId: 'cycle-0' },
    { id: 'T3', parentId: 'P2', statusType: 'completed', cycleId: 'cycle-0' },
    { id: 'P3', specRef: 's3', statusType: 'unstarted', cycleId: 'cycle-2' },
    { id: 'P4', specRef: 's4', statusType: 'completed', cycleId: 'cycle-old' });
  const evidence = new FakeEvidence({ P1: NOT_MET, P2: UNKNOWN, P3: UNKNOWN, P4: UNKNOWN });
  const result = await run(linear, evidence);

  assert.equal(result.status, 'synchronized');
  assert.deepEqual(['P1', 'P2', 'T2'].map((id) => cycleOf(linear, id)), ['cycle-1', 'cycle-1', 'cycle-1']);
  assert.deepEqual(['P1', 'P2', 'T2'].map((id) => item(result, id).action), ['carry', 'carry', 'carry']);
  assert.equal(cycleOf(linear, 'T3'), 'cycle-0');
  assert.equal(cycleOf(linear, 'P3'), 'cycle-2');
  // 只处理上一周期：更早 Cycle 里已完成的父项不被 Unknown 拉回本周
  assert.equal(cycleOf(linear, 'P4'), 'cycle-old');
  assert.equal(item(result, 'P4'), undefined);
  assert.equal(item(result, 'P2').delivery.status, 'unknown');
  assert.deepEqual(codes(result, 'evidence_unavailable'), ['P2']);
  assert.ok(linear.mutations.every((m) => m.patch.cycle === 'cycle-1'));
});

// --------------------------------------------------------------------------
// R8／F1：未来 Cycle（startsAt >= 本周结束）的项是他人排期，不拉回本周
// --------------------------------------------------------------------------

test('R8/F1：下周 Cycle 的进行中项不纳入，其余照常写入，整体 synchronized', async () => {
  const linear = linearWith(
    { id: 'P0', specRef: 's0', statusType: 'started', cycleId: 'cycle-2' },
    { id: 'P1', specRef: 's1', statusType: 'started', cycleId: null },
    { id: 'P2', specRef: 's2', statusType: 'unstarted', cycleId: 'cycle-0' });
  const result = await run(linear, new FakeEvidence({ P0: NOT_MET, P1: NOT_MET, P2: UNKNOWN }));

  assert.equal(result.status, 'synchronized');
  assert.equal(cycleOf(linear, 'P0'), 'cycle-2');
  assert.ok(!linear.mutations.some((m) => m.issueId === 'P0'), '下周项零写入');
  assert.deepEqual([item(result, 'P0').action, item(result, 'P0').write], ['unchanged', 'unchanged'], 'G4：过滤项可见');
  assert.deepEqual(['P1', 'P2'].map((id) => [cycleOf(linear, id), item(result, id).write]),
    [['cycle-1', 'verified'], ['cycle-1', 'verified']]);
});

test('R8/F1：更远 Cycle（cycle-3）的进行中项同样不写回本周', async () => {
  const linear = linearWith({ id: 'P3', specRef: 's3', statusType: 'started', cycleId: 'cycle-3' });
  const result = await run(linear, new FakeEvidence({ P3: NOT_MET }));

  assert.equal(result.status, 'synchronized');
  assert.equal(cycleOf(linear, 'P3'), 'cycle-3');
  assert.equal(linear.mutations.length, 0);
});

test('R8/F1：前读才发现项已被移到下周 Cycle（时钟未跨周）→ 该项 unchanged，不报 failure，其余继续', async () => {
  const linear = linearWith(
    { id: 'P1', specRef: 's1', statusType: 'started' },
    { id: 'P2', specRef: 's2', statusType: 'started' });
  linear.beforeRead = (id) => { if (id === 'P2') linear.issues.get('P2').cycleId = 'cycle-2'; };
  const result = await run(linear, new FakeEvidence({ P1: NOT_MET, P2: NOT_MET }));

  assert.equal(result.status, 'synchronized');
  assert.equal(cycleOf(linear, 'P2'), 'cycle-2');
  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1']);
  assert.deepEqual([item(result, 'P2').action, item(result, 'P2').write], ['unchanged', 'unchanged']);
  assert.ok(!result.problems.some((p) => p.issueId === 'P2'));
});

test('G4：父项在下周 Cycle、ticket 进行中被纳入本周 → 父项 unchanged 可见并报 workflow_drift，不写父项', async () => {
  const linear = linearWith(
    { id: 'P', specRef: 's1', statusType: 'started', cycleId: 'cycle-2' },
    { id: 'T', parentId: 'P', statusType: 'started' });
  const result = await run(linear, new FakeEvidence({ P: NOT_MET }));

  assert.deepEqual(linear.mutations, [{ issueId: 'T', patch: { cycle: 'cycle-1' } }]);
  assert.deepEqual([item(result, 'P').action, item(result, 'P').write], ['unchanged', 'unchanged']);
  assert.deepEqual([item(result, 'T').action, item(result, 'T').write], ['include', 'verified']);
  assert.deepEqual(codes(result, 'workflow_drift'), ['P']);
  assert.equal(result.status, 'synchronized');
});

test('G10：只在下周 Cycle 进行中的 ticket 不把 Backlog 父项拉进本周；ticket 记 unchanged', async () => {
  const linear = linearWith(
    { id: 'P', specRef: 's1', statusType: 'backlog' },
    { id: 'T', parentId: 'P', statusType: 'started', cycleId: 'cycle-2' });
  const result = await run(linear, new FakeEvidence({ P: NOT_MET }));

  assert.equal(linear.mutations.length, 0);
  assert.equal(cycleOf(linear, 'P'), null);
  assert.equal(item(result, 'P'), undefined);
  assert.deepEqual([item(result, 'T').action, item(result, 'T').write], ['unchanged', 'unchanged']);
  assert.equal(result.status, 'synchronized');
});

test('G6：父项上周已交付，原生滚入本周的未开始 ticket 也移出本周（not_carry，cycle=null 并回读）', async () => {
  const linear = linearWith(
    { id: 'P', specRef: 's1', statusType: 'completed', cycleId: 'cycle-0' },
    { id: 'T', parentId: 'P', statusType: 'unstarted', cycleId: 'cycle-1' },
    { id: 'D', parentId: 'P', statusType: 'completed', cycleId: 'cycle-1' });
  const result = await run(linear, new FakeEvidence({ P: delivered(LAST_WEEK) }));

  assert.deepEqual(linear.mutations, [{ issueId: 'T', patch: { cycle: null } }]);
  assert.deepEqual([cycleOf(linear, 'T'), item(result, 'T').action, item(result, 'T').write], [null, 'not_carry', 'verified']);
  assert.equal(cycleOf(linear, 'D'), 'cycle-1', '已完成 ticket 不动');
  assert.equal(result.status, 'synchronized');
});

test('R5：Done 未交付与 Started 已交付都报 workflow_drift，归属按事实处理，不写状态', async () => {
  const linear = linearWith(
    { id: 'DONE', specRef: 's1', statusType: 'completed', cycleId: 'cycle-0' },
    { id: 'LIVE', specRef: 's2', statusType: 'started', cycleId: 'cycle-1' });
  const result = await run(linear, new FakeEvidence({ DONE: NOT_MET, LIVE: delivered(LAST_WEEK) }));

  assert.deepEqual(codes(result, 'workflow_drift'), ['DONE', 'LIVE']);
  assert.equal(cycleOf(linear, 'DONE'), 'cycle-1');
  assert.equal(cycleOf(linear, 'LIVE'), null);
  assert.deepEqual(linear.snapshot().map((i) => i.statusType), ['completed', 'started']);
  assert.ok(linear.mutations.every((m) => JSON.stringify(Object.keys(m.patch)) === '["cycle"]'));
});

test('R4/R15：ticket 沿用父 MMF 判断，只读父项证据', async () => {
  const linear = linearWith(
    { id: 'P1', specRef: 's1', statusType: 'completed', cycleId: 'cycle-1' },
    { id: 'T1', parentId: 'P1', statusType: 'started', cycleId: 'cycle-1' });
  const evidence = new FakeEvidence({ P1: delivered(LAST_WEEK), T1: NOT_MET });
  const result = await run(linear, evidence);

  assert.deepEqual(evidence.reads, ['P1']);
  assert.deepEqual(item(result, 'T1').delivery, item(result, 'P1').delivery);
  assert.deepEqual([cycleOf(linear, 'P1'), cycleOf(linear, 'T1')], [null, null]);
  assert.equal(item(result, 'T1').action, 'not_carry');
  // F11：父项本周前已交付，ticket 仍 started → 给该 ticket 附 workflow_drift
  assert.deepEqual(codes(result, 'workflow_drift'), ['T1']);
});

test('R15：同一证据经公开判断与维护入口结果相同；statusType 不影响；无本地覆盖状态', async () => {
  const input = delivered(THIS_WEEK, LAST_WEEK);
  const expected = assessFormalDelivery(structuredClone(input));
  const linear = linearWith({ id: 'P1', specRef: 's1', statusType: 'started', cycleId: 'cycle-1' });
  assert.deepEqual(item(await run(linear, new FakeEvidence({ P1: input })), 'P1').delivery, expected);

  linear.issues.get('P1').statusType = 'completed';
  assert.deepEqual(item(await run(linear, new FakeEvidence({ P1: input })), 'P1').delivery, expected);

  const later = await run(linear, new FakeEvidence({ P1: NOT_MET }));
  assert.equal(item(later, 'P1').delivery.status, 'not_delivered');
});

test('F6：Evidence 返回 undefined、{} 或 verified 缺 source → Unknown + evidence_unavailable，不判已交付', async () => {
  const noSource = { state: 'verified', effectiveAt: LAST_WEEK, reason: null };
  for (const shape of [undefined, {}, { spec: noSource, main: noSource }]) {
    const linear = linearWith({ id: 'P1', specRef: 's1', statusType: 'completed', cycleId: 'cycle-1' });
    const result = await run(linear, { read: async () => shape });
    assert.equal(item(result, 'P1').delivery.status, 'unknown', JSON.stringify(shape));
    assert.deepEqual(codes(result, 'evidence_unavailable'), ['P1']);
    assert.equal(linear.mutations.length, 0, '不按已交付移出本周');
  }
});
