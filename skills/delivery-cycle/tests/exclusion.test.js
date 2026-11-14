/**
 * 显式剔除与恢复：R6、R11（重复）、T1（排除标记前置）、T4（只含允许增量字段）。
 * 期望值来源：Spec 第 5 节、第 6 节结果表、R6／T1／T4 覆盖表；Linear DD-543 验收。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintainCurrentWeek } from '../scripts/delivery-cycle.js';
import { FakeEvidence, FakeLinear, REQUEST, SCOPE, TUESDAY } from './fake-adapters.js';

const LABEL = SCOPE.exclusionLabelId;
const run = (linear, picks = {}) =>
  maintainCurrentWeek({ ...REQUEST, exclude: [], restore: [], ...picks },
    { linear, evidence: new FakeEvidence(), now: TUESDAY });
const cycleOf = (linear, id) => linear.issues.get(id).cycleId;
const labelsOf = (linear, id) => linear.issues.get(id).labels;
const codes = (result) => result.problems.map((p) => [p.code, p.issueId]);
const item = (result, id, action) => result.items.find((i) => i.issueId === id && i.action === action);

// MMF：父 P 进行中在本周，两个子票 A、B 进行中在本周，另有无关标签
function mmf() {
  return new FakeLinear()
    .add({ id: 'P', specRef: 'spec-1', cycleId: 'cycle-1', labels: ['keep-me'] })
    .add({ id: 'A', parentId: 'P', cycleId: 'cycle-1', labels: ['keep-me'] })
    .add({ id: 'B', parentId: 'P', cycleId: 'cycle-1' });
}

test('R6：剔除只增量加标记并清空本周 cycle；其他标签、状态、父子关系不变，patch 只含允许字段', async () => {
  const linear = mmf();
  const result = await run(linear, { exclude: ['A'] });
  assert.equal(result.status, 'synchronized');
  assert.deepEqual(labelsOf(linear, 'A'), ['keep-me', LABEL]);
  assert.equal(cycleOf(linear, 'A'), null);
  assert.equal(linear.issues.get('A').statusType, 'started');
  assert.equal(linear.issues.get('A').parentId, 'P');
  assert.deepEqual(linear.mutations, [{ issueId: 'A', patch: { cycle: null, addLabels: [LABEL] } }]);
  assert.equal(item(result, 'A', 'exclude').write, 'verified');
  assert.equal(result.changed, 1);
  assert.equal(cycleOf(linear, 'B'), 'cycle-1', '子票标记不影响兄弟票');
});

test('R6：不在本周的项剔除只加标记，不提交 cycle', async () => {
  const linear = new FakeLinear().add({ id: 'P', specRef: 'spec-1', cycleId: 'other' });
  await run(linear, { exclude: ['P'] });
  assert.deepEqual(linear.mutations, [{ issueId: 'P', patch: { addLabels: [LABEL] } }]);
  assert.equal(cycleOf(linear, 'P'), 'other');
});

test('R6／R11：跨两次调用及新进程，剔除项不被加回；重复剔除零 mutation、不重复标签', async () => {
  const linear = mmf();
  await run(linear, { exclude: ['P'] });
  assert.deepEqual([cycleOf(linear, 'P'), cycleOf(linear, 'A'), cycleOf(linear, 'B')], [null, null, null]);
  assert.deepEqual(labelsOf(linear, 'A'), ['keep-me'], '父标记派生生效，不复制到子票');

  // 新进程：无本地状态，只靠 Linear 上的标记
  linear.mutations = [];
  const second = await run(linear);
  assert.equal(second.status, 'synchronized');
  assert.equal(linear.mutations.length, 0);

  const repeat = await run(linear, { exclude: ['P'] });
  assert.equal(linear.mutations.length, 0);
  assert.equal(repeat.changed, 0);
  assert.equal(item(repeat, 'P', 'exclude').write, 'unchanged');
  assert.deepEqual(labelsOf(linear, 'P'), ['keep-me', LABEL]);
});

test('R6：父标记对后来出现的已核实子票同样生效', async () => {
  const linear = mmf();
  await run(linear, { exclude: ['P'] });
  linear.add({ id: 'C', parentId: 'P', cycleId: null });
  linear.add({ id: 'D', parentId: 'P', cycleId: 'cycle-1' }); // 有人手工放进本周
  linear.mutations = [];
  const result = await run(linear);
  assert.equal(cycleOf(linear, 'C'), null);
  assert.equal(cycleOf(linear, 'D'), null);
  assert.deepEqual(linear.mutations, [{ issueId: 'D', patch: { cycle: null } }]);
  assert.equal(item(result, 'D', 'exclude').write, 'verified');
});

test('R6：恢复父项保留子票自身标记；恢复后按规则重新纳入', async () => {
  const linear = mmf();
  await run(linear, { exclude: ['P', 'A'] });
  linear.mutations = [];
  const result = await run(linear, { restore: ['P'] });
  assert.deepEqual(linear.mutations[0], { issueId: 'P', patch: { removeLabels: [LABEL] } });
  assert.deepEqual(labelsOf(linear, 'P'), ['keep-me']);
  assert.deepEqual(labelsOf(linear, 'A'), ['keep-me', LABEL]);
  assert.equal(item(result, 'P', 'restore').write, 'verified');
  assert.deepEqual([cycleOf(linear, 'P'), cycleOf(linear, 'A'), cycleOf(linear, 'B')], ['cycle-1', null, 'cycle-1']);
  assert.equal(result.status, 'synchronized');
});

test('R6：恢复子票不绕过父标记', async () => {
  const linear = mmf();
  await run(linear, { exclude: ['P', 'A'] });
  linear.mutations = [];
  await run(linear, { restore: ['A'] });
  assert.deepEqual(linear.mutations, [{ issueId: 'A', patch: { removeLabels: [LABEL] } }]);
  assert.deepEqual(labelsOf(linear, 'P'), ['keep-me', LABEL]);
  assert.equal(cycleOf(linear, 'A'), null);
});

test('R6：恢复后已在本周前正式交付的工作不强制加入；无标记的恢复零 mutation', async () => {
  const linear = new FakeLinear().add({ id: 'P', specRef: 'spec-1', cycleId: null, labels: [LABEL] });
  const delivered = { state: 'verified', source: 's', effectiveAt: '2026-11-10T00:00:00Z', reason: null };
  const evidence = new FakeEvidence({ P: { spec: delivered, main: delivered } });
  const restore = () => maintainCurrentWeek({ ...REQUEST, restore: ['P'] }, { linear, evidence, now: TUESDAY });
  const result = await restore();
  assert.deepEqual(labelsOf(linear, 'P'), []);
  assert.equal(cycleOf(linear, 'P'), null);
  assert.equal(result.status, 'synchronized');

  linear.mutations = [];
  const repeat = await restore();
  assert.equal(linear.mutations.length, 0);
  assert.equal(item(repeat, 'P', 'restore').write, 'unchanged');
});

test('R6：原生自动归属使清空无效 → native_assignment_conflict，保留标记、不改状态、不宣称成功', async () => {
  const linear = mmf();
  linear.patchBehavior = async (id, patch, apply) => {
    apply();
    linear.issues.get(id).cycleId = 'cycle-1'; // 平台立即加回
    return { success: true };
  };
  const result = await run(linear, { exclude: ['A'] });
  assert.deepEqual(codes(result), [['native_assignment_conflict', 'A']]);
  assert.equal(item(result, 'A', 'exclude').write, 'failed');
  assert.equal(result.status, 'partial');
  assert.deepEqual(labelsOf(linear, 'A'), ['keep-me', LABEL]);
  assert.equal(linear.issues.get('A').statusType, 'started');
  assert.ok(linear.mutations.every((m) => !m.patch.removeLabels), '不得删标记掩盖冲突');

  // 下一次维护识别已有标记仍在本周，再次纠正
  linear.patchBehavior = null;
  const next = await run(linear);
  assert.equal(cycleOf(linear, 'A'), null);
  assert.equal(item(next, 'A', 'exclude').write, 'verified');
});

test('T1：排除标签缺失或不属于团队 → exclusion_marker_missing，整体零写入', async () => {
  for (const setup of [(l) => l.labels.clear(), (l) => l.labels.set(LABEL, { id: LABEL, teamId: 'team-x' })]) {
    const linear = mmf().add({ id: 'Q', specRef: 'spec-2' });
    setup(linear);
    const result = await run(linear, { exclude: ['A'] });
    assert.equal(result.status, 'unsynchronized');
    assert.deepEqual(codes(result), [['exclusion_marker_missing', null]]);
    assert.equal(linear.mutations.length, 0);
  }
});

test('范围外 ID 与身份不明项被拒绝且零写入；其余项照常', async () => {
  const linear = mmf()
    .add({ id: 'X', teamId: 'team-2' })
    .add({ id: 'O', statusType: 'unstarted' });
  const result = await run(linear, { exclude: ['ghost', 'O'], restore: ['X'] });
  assert.deepEqual(codes(result).filter(([, id]) => ['ghost', 'O'].includes(id)),
    [['scope_invalid', 'ghost'], ['identity_unverifiable', 'O']]);
  assert.ok(codes(result).some(([code, id]) => code === 'scope_invalid' && id === 'X'));
  assert.ok(linear.mutations.every((m) => !['ghost', 'O', 'X'].includes(m.issueId)));
  assert.deepEqual(labelsOf(linear, 'O'), []);
});

test('R9：剔除写入结果未知时不纳入该项，下次先回读、不重放', async () => {
  const linear = mmf();
  linear.patchBehavior = async (id, patch, apply) => { apply(); throw new Error('ETIMEDOUT'); };
  const reads = [];
  const original = linear.readIssue.bind(linear);
  linear.readIssue = async (id) => { reads.push(id); return reads.length === 2 ? null : original(id); };
  const result = await run(linear, { exclude: ['A'] });
  assert.equal(item(result, 'A', 'exclude').write, 'unknown');
  assert.ok(!result.items.some((i) => i.issueId === 'A' && i.action !== 'exclude'), '未定剔除项不进入纳入计划');

  linear.patchBehavior = null;
  linear.mutations = [];
  linear.readIssue = original;
  const retry = await run(linear, { exclude: ['A'] });
  assert.equal(item(retry, 'A', 'exclude').write, 'unchanged');
  assert.equal(linear.mutations.length, 0);
});
