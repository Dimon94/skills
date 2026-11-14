/**
 * 逐项结果分类与安全重试：T7、T8、T9、T11、T13；R9、R10、R11、R12。
 * 期望值来源：Spec 第 6 节稳定结果表、第 7 节重试合同与 T／R 覆盖表；
 * Adapter 响应形态见 scripts/delivery-cycle.js 的 L5 块。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintainCurrentWeek } from '../scripts/delivery-cycle.js';
import { FakeEvidence, FakeLinear, REQUEST, TUESDAY, portError } from './fake-adapters.js';

// --------------------------------------------------------------------------
// 回读可注入故障的 fake：只在外部边界模拟 Linear 响应形态
// --------------------------------------------------------------------------
class FlakyLinear extends FakeLinear {
  readBehavior = null; // (issueId, issue, readCount) => issue | null | throw

  async readIssue(issueId) {
    const issue = await super.readIssue(issueId);
    this.reads = (this.reads ?? 0) + 1;
    return this.readBehavior ? this.readBehavior(issueId, issue) : issue;
  }
}

const run = (linear, deps = {}) =>
  maintainCurrentWeek(REQUEST, { linear, evidence: new FakeEvidence(), now: TUESDAY, ...deps });
const codes = (result) => result.problems.map((p) => [p.code, p.issueId]);
const writes = (result) => result.items.map((i) => [i.issueId, i.write]);
const patched = (linear) => linear.mutations.map((m) => m.issueId);

const TIMEOUT = () => { throw new Error('ETIMEDOUT'); };
const GRAPHQL_ERRORS = { success: false, errors: [{ message: 'Issue update failed' }] };
const PARTIAL_DATA = { success: true, errors: [{ message: 'cycle: partial' }] };

// 第一次 patch 之后的回读（同一 Issue 第二次读）
const afterPatch = (shape) => {
  const seen = new Set();
  return (id, issue) => {
    if (!seen.has(id)) { seen.add(id); return issue; }
    return shape(issue);
  };
};

test('R10/T9：每种响应形态都按实际回读分类，不按 HTTP 200 或响应文字判成功', async () => {
  const cases = [
    { name: 'HTTP 200 + GraphQL errors，未生效', patch: async () => GRAPHQL_ERRORS,
      expect: ['unsynchronized', 'failed', 'write_failed', 0] },
    { name: '部分数据，未生效', patch: async () => PARTIAL_DATA,
      expect: ['unsynchronized', 'failed', 'write_failed', 0] },
    { name: '部分数据，回读已生效', patch: async (id, p, apply) => { apply(); return PARTIAL_DATA; },
      expect: ['synchronized', 'verified', null, 1] },
    { name: '超时，回读已生效', patch: async (id, p, apply) => { apply(); TIMEOUT(); },
      expect: ['synchronized', 'verified', null, 1] },
    { name: '成功响应，空回读', patch: async (id, p, apply) => { apply(); return { success: true }; },
      read: afterPatch(() => null), expect: ['unknown', 'unknown', 'write_unknown', 0] },
    { name: '成功响应，回读缺 cycleId 字段', patch: async () => ({ success: true }),
      read: afterPatch(({ cycleId, ...rest }) => rest), expect: ['unknown', 'unknown', 'write_unknown', 0] },
    { name: '空响应体', patch: async () => undefined,
      expect: ['unknown', 'unknown', 'write_unknown', 0] }
  ];
  for (const { name, patch, read, expect } of cases) {
    const linear = new FlakyLinear().add({ id: 'P1', specRef: 'spec-1' });
    linear.patchBehavior = patch;
    linear.readBehavior = read ?? null;
    const result = await run(linear);
    const [status, write, code, changed] = expect;
    assert.equal(result.status, status, name);
    assert.deepEqual(writes(result), [['P1', write]], name);
    assert.deepEqual(codes(result), code ? [[code, 'P1']] : [], name);
    assert.equal(result.changed, changed, name);
  }
});

test('T7：原本无需变更项 + 失败项 → partial，changed 为 0', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P1', specRef: 'spec-1', cycleId: 'cycle-1' })
    .add({ id: 'P2', specRef: 'spec-2' });
  linear.patchBehavior = async () => GRAPHQL_ERRORS;
  const result = await run(linear);

  assert.equal(result.status, 'partial');
  assert.equal(result.changed, 0);
  assert.deepEqual(writes(result), [['P1', 'unchanged'], ['P2', 'failed']]);
  assert.deepEqual(codes(result), [['write_failed', 'P2']]);
});

test('T8：全部必要项明确失败 → unsynchronized，权限拒绝与回读不符逐项可区分', async () => {
  const linear = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' }).add({ id: 'P2', specRef: 'spec-2' });
  linear.patchBehavior = async (id) => {
    if (id === 'P1') throw portError('permission_denied');
    return { success: true };
  };
  const result = await run(linear);

  assert.equal(result.status, 'unsynchronized');
  assert.deepEqual(codes(result), [['permission_denied', 'P1'], ['readback_mismatch', 'P2']]);
  assert.equal(result.changed, 0);
});

test('T9：无符合项，一项明确失败一项不可判定 → unknown', async () => {
  const linear = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' }).add({ id: 'P2', specRef: 'spec-2' });
  linear.patchBehavior = async (id) => (id === 'P1' ? GRAPHQL_ERRORS : TIMEOUT());
  const result = await run(linear);

  assert.equal(result.status, 'unknown');
  assert.deepEqual(codes(result), [['write_failed', 'P1'], ['write_unknown', 'P2']]);
});

test('T13/R9：实际写入成功但响应与回读都 Unknown；重试先回读，第二次 mutation 数为零', async () => {
  const linear = new FlakyLinear().add({ id: 'P1', specRef: 'spec-1' });
  linear.patchBehavior = async (id, p, apply) => { apply(); TIMEOUT(); };
  linear.readBehavior = afterPatch(() => { throw new Error('ETIMEDOUT'); });
  const first = await run(linear);
  assert.equal(first.status, 'unknown');
  assert.equal(linear.mutations.length, 1);

  linear.patchBehavior = null;
  linear.readBehavior = null;
  linear.calls.length = 0;
  const second = await run(linear);
  assert.equal(second.status, 'synchronized');
  assert.equal(second.changed, 0);
  assert.deepEqual(writes(second), [['P1', 'unchanged']]);
  assert.equal(linear.mutations.length, 1);
  assert.ok(linear.calls.includes('readIssue'));
});

test('T11/R9：从 partial 重试只补仍必要项，已成功项不回滚、不重复 patch', async () => {
  const linear = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' }).add({ id: 'P2', specRef: 'spec-2' });
  linear.patchBehavior = async (id, p, apply) => (id === 'P1' ? (apply(), { success: true }) : GRAPHQL_ERRORS);
  const first = await run(linear);
  assert.equal(first.status, 'partial');
  assert.equal(linear.issues.get('P1').cycleId, 'cycle-1');

  linear.patchBehavior = null;
  const second = await run(linear);
  assert.equal(second.status, 'synchronized');
  assert.equal(second.changed, 1);
  assert.deepEqual(writes(second), [['P1', 'unchanged'], ['P2', 'verified']]);
  assert.deepEqual(patched(linear), ['P1', 'P2', 'P2']);
  assert.ok(linear.mutations.every((m) => m.patch.cycle === 'cycle-1'));
});

// --------------------------------------------------------------------------
// R12：失败同步不改 Issue 事实；结果不携带 gate 指令
// --------------------------------------------------------------------------
// 开发链路状态不在本 skill 的 port 内：只断言结果形状与 Linear 调用面，不伪造开发链路替身
test('R12：失败同步只返回维护结果，不含 gate／派发／预算指令，Issue 事实与调用面不越界', async () => {
  const linear = new FakeLinear()
    .add({ id: 'P1', specRef: 'spec-1', blockedBy: ['X-1'], assignee: 'agent-a' })
    .add({ id: 'P2', specRef: 'spec-2' });
  linear.patchBehavior = async (id) => (id === 'P1' ? TIMEOUT() : GRAPHQL_ERRORS);
  const issuesBefore = linear.snapshot();
  const result = await run(linear);

  assert.equal(result.status, 'unknown');
  assert.deepEqual(linear.snapshot(), issuesBefore);
  assert.deepEqual(Object.keys(result).sort(), ['changed', 'items', 'problems', 'status', 'week']);
  assert.doesNotMatch(JSON.stringify(result), /gate|hook|dispatch|budget|recover|block/i);
  const allowed = new Set(['readCycleConfiguration', 'listCycles', 'readLabel', 'listIssues', 'readIssue', 'patchIssue']);
  assert.ok(linear.calls.every((c) => allowed.has(c)));
});

test('F4：patchIssue 抛 capability_unavailable → 确定失败原样上报，不归 write_unknown', async () => {
  const linear = new FakeLinear().add({ id: 'P1', specRef: 'spec-1' });
  linear.patchBehavior = async () => { throw portError('capability_unavailable'); };
  const result = await run(linear);
  assert.deepEqual(codes(result), [['capability_unavailable', 'P1']]);
  assert.deepEqual(writes(result), [['P1', 'failed']]);
  assert.equal(result.status, 'unsynchronized');
});
