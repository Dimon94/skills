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
  { id: 'cycle-2', startsAt: WEEK.end, endsAt: '2026-11-29T16:00:00.000Z' }
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
