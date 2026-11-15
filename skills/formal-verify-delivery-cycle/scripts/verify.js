#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/formal-verify-delivery-cycle/scripts/verify.js
//   INPUT: repo://skills/delivery-cycle/scripts/delivery-cycle.js 的 maintainCurrentWeek（真实产品代码，不复刻）；
//          ./world.js（环境与故障注入）
//   OUTPUT: stdout 每场景轨迹数、步数上界与反例；退出码 0 = 全部性质在界内成立，1 = 有反例
//   POS: 有界穷举调度探索，不是无界证明；不覆盖真实 Linear 平台行为
//   TEST: node skills/formal-verify-delivery-cycle/scripts/mutants.js（每条性质都能被真实代码错误变体打破）
// L6
//   TRACE: run0、run1 可消耗环境事件与故障预算；run2 冻结环境（恢复轮）；run3 冻结并检查 R11
//   PROPERTIES: R8 不写回旧周；R9 先读后写、不盲重放；R9V verified 必有写后回读；
//               R9S synchronized 不掩盖失败；R11 稳定状态重跑零写入
// ==========================================================================

import { maintainCurrentWeek } from '../../delivery-cycle/scripts/delivery-cycle.js';
import { World, Chooser, nextPrefix, SCENARIOS, FakeEvidence } from './world.js';
import { SCOPE } from '../../delivery-cycle/tests/fake-adapters.js';

const BOUNDS = Object.freeze({ env: 2, faults: 2 });
const RUNS = 4;
const BAD_WRITES = new Set(['failed', 'unknown']);
const BLOCKING = new Set(['cycle_expired', 'configuration_mismatch', 'cycle_missing', 'write_unknown', 'write_failed']);

// 一条轨迹：同一 World 上连跑 RUNS 次真实 maintainCurrentWeek
async function trace(scenario, prefix) {
  const chooser = new Chooser(prefix);
  const world = new World(scenario, chooser, BOUNDS);
  const request = { scope: SCOPE, exclude: scenario.exclude, restore: [] };
  for (let run = 0; run < RUNS; run += 1) {
    Object.assign(world, { run, frozen: run >= 2 });
    const before = world.mutations.length;
    const result = await maintainCurrentWeek(request, { linear: world, evidence: new FakeEvidence(), now: world.now });
    world.log.push({ run, op: 'result', status: result.status, changed: result.changed });
    checkResult(world, run, result);
    if (run === RUNS - 1) checkIdempotent(world, run, result, world.mutations.length - before);
  }
  return { world, chooser };
}

const satisfied = (patch, s) => s && ('cycle' in patch ? s.cycleId === patch.cycle : true)
  && (patch.addLabels ?? []).every((l) => s.labels.includes(l))
  && (patch.removeLabels ?? []).every((l) => !s.labels.includes(l));

// R9V：verified 项在本轮最后一次 patch 之后必须有可读且满足 patch 的回读
function checkResult(world, run, result) {
  const mine = world.log.filter((e) => e.run === run);
  for (const item of result.items.filter((i) => i.write === 'verified')) {
    const ops = mine.filter((e) => e.id === item.issueId);
    const p = ops.findLastIndex((e) => e.op === 'patch');
    const after = ops.slice(p + 1).find((e) => e.op === 'read');
    if (p < 0 || !satisfied(ops[p].patch, after?.state)) {
      world.violations.push({ property: 'R9V', run, id: item.issueId, why: 'verified 没有满足写入的写后回读' });
    }
  }
  if (result.status !== 'synchronized') return;
  const bad = result.items.filter((i) => BAD_WRITES.has(i.write)).map((i) => i.issueId);
  const blocking = result.problems.filter((p) => BLOCKING.has(p.code)).map((p) => p.code);
  if (bad.length || blocking.length) {
    world.violations.push({ property: 'R9S', run, why: `synchronized 但有 ${[...bad, ...blocking].join(',')}` });
  }
}

function checkIdempotent(world, run, result, writes) {
  if (writes || result.changed) {
    world.violations.push({ property: 'R11', run, why: `稳定状态重跑仍写 ${writes} 次，changed=${result.changed}` });
  }
}

// 反例按代码名词逐步讲：读、写、环境事件、每轮结果
function story({ world, chooser }) {
  const lines = world.log.map((e) => `  run${e.run} ${describe(e)}`);
  return [`  choices=[${chooser.taken.join(',')}]`, ...lines].join('\n');
}

const ENV_TEXT = Object.freeze({
  roll: 'Linear 原生滚动 cycle-0 → cycle-1',
  monday: '上海时钟跨到周一 00:00',
  manual: '他人手动把 P1 移到 cycle-1'
});

function describe(e) {
  if (e.op === 'env') return ENV_TEXT[e.event];
  if (e.op === 'read') return `readIssue ${e.id} → ${e.state ? `cycleId=${e.state.cycleId} labels=[${e.state.labels}]` : '超时'}`;
  if (e.op === 'patch') return `patchIssue ${e.id} ${JSON.stringify(e.patch)} → ${e.outcome}`;
  return `maintainCurrentWeek → status=${e.status} changed=${e.changed}`;
}

async function explore(name, scenario) {
  const stats = { traces: 0, maxDepth: 0, races: 0, first: new Map() };
  for (let prefix = []; prefix; ) {
    const t = await trace(scenario, prefix);
    stats.traces += 1;
    stats.maxDepth = Math.max(stats.maxDepth, t.chooser.taken.length);
    if (t.world.races) stats.races += 1;
    for (const v of t.world.violations) if (!stats.first.has(v.property)) stats.first.set(v.property, { v, t });
    prefix = nextPrefix(t.chooser);
  }
  return stats;
}

const only = process.argv.slice(2);
let failed = false;
for (const [name, scenario] of Object.entries(SCENARIOS).filter(([n]) => !only.length || only.includes(n))) {
  const stats = await explore(name, scenario);
  console.log(`[${name}] traces=${stats.traces} maxChoices=${stats.maxDepth} unobservedRaceTraces=${stats.races}`
    + ` bounds=env≤${BOUNDS.env},faults≤${BOUNDS.faults},runs=${RUNS}`);
  for (const [property, { v, t }] of stats.first) {
    failed = true;
    console.log(`VIOLATION ${property} run${v.run} ${v.id ?? ''}: ${v.why}\n${story(t)}`);
  }
}
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS (R8 R9 R9V R9S R11 within bounds)');
process.exitCode = failed ? 1 : 0;
