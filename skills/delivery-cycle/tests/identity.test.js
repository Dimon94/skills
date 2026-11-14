/**
 * MMF 身份与进行中纳入：R2、R3、R13。
 * 期望值来源：Spec R2／R3 与第 4 节；fake 每页 2 条，强制走分页。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintainCurrentWeek } from '../scripts/delivery-cycle.js';
import { FakeEvidence, FakeLinear, REQUEST, TUESDAY } from './fake-adapters.js';

const run = (linear) => maintainCurrentWeek(REQUEST, { linear, evidence: new FakeEvidence(), now: TUESDAY });
const cycleOf = (linear, id) => linear.issues.get(id).cycleId;

test('R3：父 Backlog、子 Started → 只纳入父项与该子项，不纳入未开始兄弟', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P1', specRef: 'spec-1', statusType: 'backlog' })
    .add({ id: 'T1', parentId: 'P1', statusType: 'started' })
    .add({ id: 'T2', parentId: 'P1', statusType: 'backlog' })
    .add({ id: 'T3', parentId: 'P1', statusType: 'completed' });
  const result = await run(linear);

  assert.equal(result.status, 'synchronized');
  assert.deepEqual(linear.mutations.map((m) => m.issueId).sort(), ['P1', 'T1']);
  assert.equal(cycleOf(linear, 'T2'), null);
  assert.equal(cycleOf(linear, 'T3'), null);
  assert.equal(linear.issues.get('P1').statusType, 'backlog');
});

test('R3：父 Started、无进行中子票 → 只纳入父项', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P1', specRef: 'spec-1' })
    .add({ id: 'T1', parentId: 'P1', statusType: 'unstarted' });
  await run(linear);
  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1']);
});

test('R3：无进行中关联的 Backlog MMF 不灌入本周', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P1', specRef: 'spec-1', statusType: 'backlog' })
    .add({ id: 'T1', parentId: 'P1', statusType: 'backlog' });
  const result = await run(linear);
  assert.equal(result.status, 'synchronized');
  assert.deepEqual(result.items, []);
  assert.equal(linear.mutations.length, 0);
});

test('R2：Epic 不进入 Cycle；相同标题但无 Spec 引用的断裂项报 identity_unverifiable', async () => {
  const linear = new FakeLinear()
    .add({ id: 'EPIC', title: 'Epic', statusType: 'started' })
    .add({ id: 'P1', specRef: 'spec-1', parentId: 'EPIC', title: 'Same' })
    .add({ id: 'ORPHAN', parentId: 'missing', title: 'Same' })
    .add({ id: 'LONE', title: 'Same' });
  const result = await run(linear);

  assert.equal(cycleOf(linear, 'EPIC'), null);
  assert.equal(cycleOf(linear, 'P1'), 'cycle-1');
  assert.equal(cycleOf(linear, 'ORPHAN'), null);
  const unverified = result.problems.filter((p) => p.code === 'identity_unverifiable').map((p) => p.issueId);
  assert.deepEqual(unverified.sort(), ['LONE', 'ORPHAN']);
  assert.equal(result.status, 'partial');
});

test('R2：第二、三页的子票仍归入第一页的父项', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P1', specRef: 'spec-1', statusType: 'backlog' })
    .add({ id: 'X1', parentId: 'P1', statusType: 'backlog' })
    .add({ id: 'X2', parentId: 'P1', statusType: 'backlog' })
    .add({ id: 'X3', parentId: 'P1', statusType: 'backlog' })
    .add({ id: 'T9', parentId: 'P1', statusType: 'started' });
  await run(linear);
  assert.deepEqual(linear.mutations.map((m) => m.issueId).sort(), ['P1', 'T9']);
});

test('R2/R13：listIssues 混入跨团队／项目项 → scope_invalid 且零写入该项', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P1', specRef: 'spec-1' })
    .add({ id: 'FOREIGN', specRef: 'spec-x', teamId: 'team-2' })
    .add({ id: 'OTHER', specRef: 'spec-y', projectId: 'project-2' });
  const result = await run(linear);

  assert.deepEqual(linear.mutations.map((m) => m.issueId), ['P1']);
  const invalid = result.problems.filter((p) => p.code === 'scope_invalid').map((p) => p.issueId);
  assert.deepEqual(invalid.sort(), ['FOREIGN', 'OTHER']);
});

test('R4（最小）：证据 Unknown 不阻断纳入，结果附 evidence_unavailable', async () => {
  const linear = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' });
  const unknown = { state: 'unknown', source: null, effectiveAt: null, reason: 'missing' };
  const evidence = new FakeEvidence({ P1: { spec: unknown, main: unknown } });
  const result = await maintainCurrentWeek(REQUEST, { linear, evidence, now: TUESDAY });

  assert.equal(result.status, 'synchronized');
  assert.equal(result.items[0].delivery.status, 'unknown');
  assert.deepEqual(result.problems.map((p) => p.code), ['evidence_unavailable']);
});

test('F8：本周 Cycle 里的未开始 ticket 不让 Backlog 父项被纳入', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P', specRef: 'spec-1', statusType: 'backlog' })
    .add({ id: 'T', parentId: 'P', statusType: 'unstarted', cycleId: 'cycle-1' })
    .add({ id: 'S', parentId: 'P', statusType: 'backlog' });
  await run(linear);
  assert.ok(!linear.mutations.some((m) => m.issueId === 'P'), '父项零写入');
  assert.equal(cycleOf(linear, 'P'), null);
});

test('F9：分页声称有下一页但游标为空或不前进 → capability_unavailable，零写入', async () => {
  for (const mode of ['null', 'empty', 'same']) {
    const linear = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' });
    let calls = 0;
    linear.listIssues = async (scope, cursor) => {
      calls += 1; // 防止错误实现死循环：多次后交出数据
      if (calls > 5) return { nodes: [structuredClone(linear.issues.get('P1'))], pageInfo: { hasNextPage: false, endCursor: null } };
      const endCursor = { null: null, empty: '', same: cursor ?? 'c1' }[mode];
      return { nodes: [], pageInfo: { hasNextPage: true, endCursor } };
    };
    const result = await run(linear);
    assert.deepEqual(result.problems.map((p) => p.code), ['capability_unavailable'], mode);
    assert.equal(linear.mutations.length, 0, mode);
  }
});
