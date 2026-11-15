// ==========================================================================
// L3
//   COORD: skills/formal-verify-delivery-cycle/scripts/world.js
//   INPUT: repo://skills/delivery-cycle/tests/fake-adapters.js（FakeLinear、FakeEvidence、WEEK、SCOPE、portError）
//   OUTPUT: Chooser（选择序列回放）、World（在每个 port await 前注入环境事件与故障的 LinearPort）、SCENARIOS
//   POS: 有界调度探索的环境；不复刻 delivery-cycle 业务规则，只模拟外部系统与时钟
//   TEST: node skills/formal-verify-delivery-cycle/scripts/verify.js（含 mutants.js 的失败证明）
// L6
//   ATOMIC: 本模型假定一次 port 调用 = 一步，环境事件只放在调用进入前；
//           真实远端请求在途交错与响应快照时点不在本界内，JS 单线程不保证远端原子性
//   BOUND: 每条轨迹环境事件 ≤ bounds.env，故障 ≤ bounds.faults；用尽后该选择点不再分叉
// ==========================================================================

import { FakeLinear, FakeEvidence, WEEK, SCOPE, portError } from '../../delivery-cycle/tests/fake-adapters.js';

export const CYCLES = Object.freeze([
  { id: 'cycle-0', startsAt: '2026-11-08T16:00:00.000Z', endsAt: WEEK.start },
  { id: 'cycle-1', startsAt: WEEK.start, endsAt: WEEK.end }
]);
// 上海 2026-11-15 周日 23:59:59，属旧周 cycle-0；下一秒是 cycle-1 的周一 00:00
export const SUNDAY_LATE = '2026-11-15T15:59:59.000Z';
export { FakeEvidence };

// 场景：初始 Issue 与本次请求；每个 MMF 父项带 specRef，无子项
export const SCENARIOS = Object.freeze({
  carry: { issues: [{ id: 'P1' }, { id: 'P2', cycleId: 'cycle-0' }, { id: 'P3' }], exclude: [] },
  exclude: { issues: [{ id: 'P1', cycleId: 'cycle-0' }, { id: 'P2' }], exclude: ['P1'] }
});

// patchIssue 结果：applied 表示平台是否真的写入；respond 是返回或抛出
const PATCH_OUTCOMES = Object.freeze([
  { name: 'ok', applied: true, respond: () => ({ success: true }) },
  { name: 'timeout_after_apply', applied: true, respond: () => { throw new Error('timeout'); } },
  { name: 'timeout_before_apply', applied: false, respond: () => { throw new Error('timeout'); } },
  { name: 'empty_body_after_apply', applied: true, respond: () => ({}) },
  { name: 'rejected', applied: false, respond: () => ({ errors: [{ message: 'rejected' }] }) },
  { name: 'permission_denied', applied: false, respond: () => { throw portError('permission_denied'); } },
  { name: 'ack_not_applied', applied: false, respond: () => ({ success: true }) }
]);
const MANUAL_TARGET = 'P1';
const CYCLE_ORDER = Object.freeze({ 'cycle-0': 0, 'cycle-1': 1 });
const weekCycleAt = (at) => (Date.parse(at) < Date.parse(WEEK.start) ? 'cycle-0' : 'cycle-1');

// 选择序列：prefix 之后一律取 0；taken／widths 供 DFS 求下一条序列
export class Chooser {
  constructor(prefix) {
    this.prefix = prefix;
    this.taken = [];
    this.widths = [];
  }

  pick(width) {
    if (width <= 1) return 0;
    const value = this.taken.length < this.prefix.length ? this.prefix[this.taken.length] : 0;
    this.taken.push(value);
    this.widths.push(width);
    return value;
  }
}

// 下一条未探索序列；穷尽返回 null
export function nextPrefix({ taken, widths }) {
  for (let j = taken.length - 1; j >= 0; j -= 1) {
    if (taken[j] + 1 < widths[j]) return [...taken.slice(0, j), taken[j] + 1];
  }
  return null;
}

// 每个 port await 前是一个选择点：环境事件（原生滚动、跨周一）与故障；log 记录可观察事实
export class World extends FakeLinear {
  constructor(scenario, chooser, bounds) {
    super({ cycles: CYCLES });
    for (const issue of scenario.issues) this.add({ specRef: `spec-${issue.id}`, ...issue });
    Object.assign(this, { chooser, env: bounds.env, faults: bounds.faults, clock: SUNDAY_LATE });
    Object.assign(this, { run: 0, log: [], violations: [], races: 0, frozen: false });
    this.patchBehavior = (id, patch, apply) => this.respond(id, patch, apply);
  }

  now = () => new Date(this.clock);

  // 环境事件；frozen 时（R11 重跑）不分叉
  envStep() {
    if (this.frozen || this.env <= 0) return;
    const options = ['none'];
    if (!this.rolled?.has('cycle-0')) options.push('roll');
    if (this.clock !== WEEK.start) options.push('monday');
    if (!this.moved) options.push('manual');
    const event = options[this.chooser.pick(options.length)];
    if (event === 'none') return;
    this.env -= 1;
    if (event === 'roll') this.nativeRoll('cycle-0', 'cycle-1');
    else if (event === 'manual') this.manualMove();
    else this.clock = WEEK.start;
    this.log.push({ run: this.run, op: 'env', event });
  }

  // 他人手动把 MANUAL_TARGET 排进下一周 cycle-1（每条轨迹至多一次）
  manualMove() {
    this.moved = true;
    this.issues.get(MANUAL_TARGET).cycleId = 'cycle-1';
  }

  fault(width) {
    if (this.frozen || this.faults <= 0) return 0;
    const choice = this.chooser.pick(width);
    if (choice) this.faults -= 1;
    return choice;
  }

  async listCycles(scope, cursor) {
    this.envStep();
    return super.listCycles(scope, cursor);
  }

  async readIssue(issueId) {
    this.envStep();
    if (this.fault(2)) {
      this.log.push({ run: this.run, op: 'read', id: issueId, state: null });
      throw new Error('timeout');
    }
    const state = await super.readIssue(issueId);
    this.log.push({ run: this.run, op: 'read', id: issueId, state: structuredClone(state) });
    return state;
  }

  async patchIssue(issueId, patch) {
    this.checkSend(issueId, patch);
    this.envStep();
    return super.patchIssue(issueId, patch);
  }

  respond(id, patch, apply) {
    const outcome = PATCH_OUTCOMES[this.fault(PATCH_OUTCOMES.length)];
    const moveBack = patch.cycle && CYCLE_ORDER[this.issues.get(id).cycleId] > CYCLE_ORDER[patch.cycle];
    if (outcome.applied && moveBack) this.races += 1; // 前读之后的未观察竞态：无 CAS，不在性质内
    if (outcome.applied) apply();
    this.log.push({ run: this.run, op: 'patch', id, patch: structuredClone(patch), outcome: outcome.name });
    return outcome.respond();
  }

  // R8 与 R9 在发送时刻核对：只用发送前已被代码观察到的事实（本轮最后一次读、当前时钟）
  checkSend(id, patch) {
    const mine = this.log.filter((e) => e.run === this.run && e.id === id);
    const last = mine.at(-1);
    const fail = (property, why) => this.violations.push({ property, run: this.run, id, patch, why });
    if (patch.cycle && patch.cycle !== weekCycleAt(this.clock)) fail('R8', `时钟已在 ${weekCycleAt(this.clock)} 周仍写 ${patch.cycle}`);
    if (last?.op !== 'read' || !last.state) return fail('R9', '发送前没有本轮可读的新前读（盲重放）');
    if (patch.cycle && CYCLE_ORDER[last.state.cycleId] > CYCLE_ORDER[patch.cycle]) {
      fail('R8', `前读已在 ${last.state.cycleId}，仍写回 ${patch.cycle}`);
    }
    if (!needed(patch, last.state)) fail('R9', `前读已符合仍发送 ${JSON.stringify(patch)}`);
  }
}

// patch 每个字段都会改变 state 才算必要；空 patch 不必要
export function needed(patch, state) {
  const checks = [];
  if ('cycle' in patch) checks.push(state.cycleId !== patch.cycle);
  for (const l of patch.addLabels ?? []) checks.push(!state.labels.includes(l));
  for (const l of patch.removeLabels ?? []) checks.push(state.labels.includes(l));
  return checks.length > 0 && checks.every(Boolean);
}
