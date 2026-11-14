/**
 * 周与配置核对：R1、T1、T2、T12。
 * 期望值来源：Spec R1／第 6 节稳定结果表；周边界手算（2026-11-16 周一，上海 = UTC+8）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintainCurrentWeek } from '../scripts/delivery-cycle.js';
import { COMPLIANT_CONFIG, FakeEvidence, FakeLinear, REQUEST, TUESDAY, WEEK, portError } from './fake-adapters.js';

const run = (linear, now = TUESDAY, request = REQUEST) =>
  maintainCurrentWeek(request, { linear, evidence: new FakeEvidence(), now });

function blockedLinear(options) {
  return new FakeLinear(options).add({ id: 'P1', specRef: 'spec-1' });
}

function assertBlocked(result, linear, code) {
  assert.equal(result.status, 'unsynchronized');
  assert.deepEqual(result.problems.map((p) => p.code), [code]);
  assert.equal(linear.mutations.length, 0);
}

test('R1：上海周一 00:00 是新周起点，前 1ms 仍属旧周', async () => {
  const atMonday = await run(new FakeLinear(), () => new Date('2026-11-15T16:00:00.000Z'));
  assert.equal(atMonday.week.start, WEEK.start);
  assert.equal(atMonday.week.end, WEEK.end);
  assert.equal(atMonday.week.cycleId, 'cycle-1');

  const before = await run(new FakeLinear(), () => new Date('2026-11-15T15:59:59.999Z'));
  assert.equal(before.week.start, '2026-11-08T16:00:00.000Z');
  assert.equal(before.week.end, WEEK.start);
});

test('R1：上海周日 23:59 仍属本周，下一周一 00:00 不含在本周', async () => {
  const sunday = await run(new FakeLinear(), () => new Date('2026-11-22T15:59:00Z'));
  assert.equal(sunday.week.start, WEEK.start);
  const nextMonday = await run(new FakeLinear(), () => new Date(WEEK.end));
  assert.equal(nextMonday.week.start, WEEK.end);
});

test('T1/T3：合规配置与当周 Cycle、无工作项时 synchronized 且零写入', async () => {
  const linear = new FakeLinear();
  const result = await run(linear);
  assert.equal(result.status, 'synchronized');
  assert.equal(result.changed, 0);
  assert.deepEqual(result.problems, []);
  assert.equal(linear.mutations.length, 0);
});

const MISMATCHES = [
  ['双周', { cycleDurationWeeks: 2 }],
  ['非周一', { cycleStartDay: 0 }],
  ['非上海时区', { timezone: 'UTC' }],
  ['Cycle 未启用', { cyclesEnabled: false }],
  ['cooldown 打断连续单周', { cooldownWeeks: 1 }]
];

for (const [name, override] of MISMATCHES) {
  test(`T2/R1：${name} → configuration_mismatch，零写入`, async () => {
    const linear = blockedLinear({ config: { ...COMPLIANT_CONFIG, ...override } });
    assertBlocked(await run(linear), linear, 'configuration_mismatch');
  });
}

test('T2/R1：真实样本双周边界（配置字段看似合规）也不截半，configuration_mismatch', async () => {
  // 协调笔记回读：Dawn #1 2026-11-15T16:00Z → 2026-11-29T16:00Z
  const cycles = [{ id: 'biweekly', startsAt: WEEK.start, endsAt: '2026-11-29T16:00:00.000Z' }];
  const linear = blockedLinear({ cycles });
  assertBlocked(await run(linear), linear, 'configuration_mismatch');
});

test('T2/R1：配置字段缺失或 unknown → configuration_unverifiable，零写入', async () => {
  for (const config of [{ ...COMPLIANT_CONFIG, timezone: 'unknown' }, { cyclesEnabled: true }]) {
    const linear = blockedLinear({ config });
    assertBlocked(await run(linear), linear, 'configuration_unverifiable');
  }
});

test('T2/R10：权限不足或能力缺失原样上报，零写入', async () => {
  for (const code of ['permission_denied', 'capability_unavailable']) {
    const linear = blockedLinear({ config: portError(code) });
    assertBlocked(await run(linear), linear, code);
  }
});

test('T2：没有覆盖当周的 Cycle → cycle_missing，不创建 Cycle', async () => {
  const cycles = [{ id: 'old', startsAt: '2026-11-08T16:00:00.000Z', endsAt: WEEK.start }];
  const linear = blockedLinear({ cycles });
  assertBlocked(await run(linear), linear, 'cycle_missing');
  assert.ok(!linear.calls.some((c) => /create/i.test(c)));
});

test('T2：Cycle 分页时当周在第二页仍能找到', async () => {
  const cycles = [
    { id: 'a', startsAt: '2026-10-25T16:00:00.000Z', endsAt: '2026-11-01T16:00:00.000Z' },
    { id: 'b', startsAt: '2026-11-01T16:00:00.000Z', endsAt: '2026-11-08T16:00:00.000Z' },
    { id: 'current', startsAt: WEEK.start, endsAt: WEEK.end }
  ];
  const result = await run(new FakeLinear({ cycles }));
  assert.equal(result.week.cycleId, 'current');
});

test('T12：前置解除后再次调用重新读取配置并写入', async () => {
  const linear = blockedLinear({ config: { ...COMPLIANT_CONFIG, cycleDurationWeeks: 2 } });
  assertBlocked(await run(linear), linear, 'configuration_mismatch');

  linear.config = COMPLIANT_CONFIG;
  const result = await run(linear);
  assert.equal(result.status, 'synchronized');
  assert.equal(result.changed, 1);
  assert.equal(linear.issues.get('P1').cycleId, 'cycle-1');
});
