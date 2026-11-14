// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/delivery-cycle.js
//   INPUT: LinearPort（Cycle 配置、Cycle、Issue 读写）；EvidencePort（原 Spec／closeout 证据）；now()
//   OUTPUT: assessFormalDelivery、maintainCurrentWeek；唯一写入是 LinearPort.patchIssue 的 cycle 字段
//   POS: delivery-cycle 唯一公开 Seam；不拥有 Linear 配置、Spec 验收、main 合入事实或 M2/M3 入口
//   TEST: node --test skills/delivery-cycle/tests/*.test.js
//   PROTOCOL: 公开签名或结果形状变化时同步 repo://skills/delivery-cycle/SKILL.md 与
//             repo://docs/proposals/2026-11-14-delivery-cycle-m1-spec.md（Linear DD-540 为准）
// L5
//   PARAM: now() → Date；Asia/Shanghai 固定 UTC+8（无夏令时），周 = 周一 00:00 起的左闭右开 7 天
//   PARAM: readCycleConfiguration → {cyclesEnabled, timezone, cycleDurationWeeks, cycleStartDay, cooldownWeeks}
//          cycleStartDay 采用 JS getDay 编号（1 = 周一）；缺字段、null 或 'unknown' 均视为无法核实
//   PARAM: listCycles / listIssues(scope, cursor) → {nodes, pageInfo: {hasNextPage, endCursor}}
//   PARAM: Issue → {id, teamId, projectId, statusType, labels, parentId, cycleId, specRef}
//          specRef 非空 = MMF 父 Spec Issue；其直接子项 = ticket；身份只看 id／parentId／specRef
//   FAIL: port 抛出带 code 的错误，code ∈ {permission_denied, capability_unavailable} 原样上报
// ==========================================================================

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const PORT_CODES = new Set(['permission_denied', 'capability_unavailable']);
const DONE_TYPES = new Set(['completed', 'canceled']);
// 父项状态与正式交付冲突 → workflow_drift；只报告，不改状态
const DRIFT = Object.freeze({ completed: 'not_delivered', started: 'delivered' });
const REQUIRED_CONFIGURATION = Object.freeze({
  cyclesEnabled: true,
  timezone: 'Asia/Shanghai',
  cycleDurationWeeks: 1,
  cycleStartDay: 1,
  cooldownWeeks: 0
});

// 前置核对失败：零写入，整体 unsynchronized，或已有符合项时 partial
class Blocked extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ==========================================================================
// L4 assessFormalDelivery
//   IN: {spec: Evidence, main: Evidence}；Evidence = {state, source, effectiveAt, reason}
//   OUT: {status, spec, main, effectiveAt}；verified+verified → delivered，任一 not_met → not_delivered，
//        其余 unknown；effectiveAt 仅在 delivered 且两时间齐全时取较晚值，否则 null
//   INVARIANT: 不读 Linear 状态，不改输入，不产生写入
//   TEST: tests/assessment.test.js（九组合）、tests/carryover.test.js（与维护入口同一结果）
// ==========================================================================
export function assessFormalDelivery({ spec, main }) {
  const status = deliveryStatus(spec.state, main.state);
  const effectiveAt = status === 'delivered' ? laterOf(spec.effectiveAt, main.effectiveAt) : null;
  return { status, spec, main, effectiveAt };
}

function deliveryStatus(spec, main) {
  if (spec === 'verified' && main === 'verified') return 'delivered';
  if (spec === 'not_met' || main === 'not_met') return 'not_delivered';
  return 'unknown';
}

function laterOf(a, b) {
  if (!a || !b) return null;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

// ==========================================================================
// L4 maintainCurrentWeek
//   IN: request = {scope: {teamId, projectId, exclusionLabelId}, exclude: [], restore: []}
//       dependencies = {linear: LinearPort, evidence: EvidencePort, now}
//   OUT: {status, week: {start, end, cycleId}, changed, items, problems}
//        synchronized：无前置阻断且全部相关项 verified／unchanged；partial：有符合项也有失败；
//        unknown：无符合项且至少一项 write_unknown；unsynchronized：其余
//   INVARIANT: changed 只计回读确认的变更；patch 只含 cycle；scope 外对象零写入
//   INVARIANT: 不写 status／state；旧周 Cycle 历史不改；not_carry 只把本周 Cycle 改为 null
//   FAIL: 稳定 code 见 repo://docs/proposals/2026-11-14-delivery-cycle-m1-spec.md 第 6 节
//   TEST: tests/configuration.test.js、tests/identity.test.js、tests/synchronization.test.js、tests/carryover.test.js
// L6
//   WHY: 无 CAS，只能逐项前读、最小 patch、业务字段回读，并如实报告观察到的事实
//   CHAIN: 配置核对 → 完整分页找当周与上一周期 Cycle → 完整分页 Issue → 身份分组 →
//          每 MMF 读一次父项证据 → 按交付结论定归属（carry／include／not_carry／保持原归属） →
//          逐项 [重算当周 → 前读 → patch → 回读]；跨过周一立即停止旧周后续写入
//   FAIL: exclude／restore 尚未实现（DD-543），非空时 capability_unavailable 且零写入
//   TEST: tests/synchronization.test.js（漂移、跨周、回读不符、重复执行）
// ==========================================================================
export async function maintainCurrentWeek(request, { linear, evidence, now }) {
  const run = { blocked: false, week: { ...shanghaiWeek(now()), cycleId: null }, changed: 0, items: [], problems: [] };
  try {
    requireSupportedRequest(request);
    const { cycleId, ...cycles } = await findCurrentCycle(request.scope, linear, run.week);
    run.week.cycleId = cycleId;
    const targets = await planTargets(request.scope, { linear, evidence, ...cycles }, run);
    for (const target of targets) await applyTarget(target, { linear, now }, run);
  } catch (err) {
    if (!(err instanceof Blocked)) throw err;
    run.blocked = true;
    run.problems.push({ code: err.code, issueId: null, message: err.message });
  }
  return finish(run);
}

function shanghaiWeek(date) {
  const local = date.getTime() + SHANGHAI_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const sinceMonday = (new Date(dayStart).getUTCDay() + 6) % 7;
  const start = dayStart - sinceMonday * DAY_MS - SHANGHAI_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + 7 * DAY_MS).toISOString() };
}

function requireSupportedRequest({ exclude = [], restore = [] }) {
  if (exclude.length || restore.length) {
    throw new Blocked('capability_unavailable', 'exclude/restore 尚未实现（DD-543），本次零写入');
  }
}

// --------------------------------------------------------------------------
// 前置核对：配置与当周 Cycle
// --------------------------------------------------------------------------

async function callPort(call, fallbackCode) {
  try {
    return await call();
  } catch (err) {
    throw new Blocked(PORT_CODES.has(err?.code) ? err.code : fallbackCode, String(err?.message ?? err));
  }
}

async function readAllPages(fetchPage) {
  const nodes = [];
  let cursor = null;
  do {
    const page = await fetchPage(cursor);
    nodes.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor !== null);
  return nodes;
}

function verifyConfiguration(config) {
  const entries = Object.entries(REQUIRED_CONFIGURATION);
  const unknown = entries.filter(([key]) => [undefined, null, 'unknown'].includes(config?.[key]));
  if (unknown.length) {
    throw new Blocked('configuration_unverifiable', `无法核实：${unknown.map(([k]) => k).join(', ')}`);
  }
  const wrong = entries.filter(([key, value]) => config[key] !== value);
  if (wrong.length) {
    const detail = wrong.map(([k, v]) => `${k}=${config[k]}（应为 ${v}）`).join(', ');
    throw new Blocked('configuration_mismatch', `团队周期配置不合规：${detail}`);
  }
}

async function findCurrentCycle(scope, linear, week) {
  const config = await callPort(() => linear.readCycleConfiguration(scope.teamId), 'configuration_unverifiable');
  verifyConfiguration(config);
  const cycles = await callPort(() => readAllPages((c) => linear.listCycles(scope, c)), 'capability_unavailable');
  const start = Date.parse(week.start);
  const exact = cycles.find((c) => Date.parse(c.startsAt) === start && Date.parse(c.endsAt) === Date.parse(week.end));
  const pastIds = new Set(cycles.filter((c) => Date.parse(c.endsAt) <= start).map((c) => c.id));
  const previousId = cycles.find((c) => Date.parse(c.endsAt) === start)?.id ?? null;
  if (exact) return { cycleId: exact.id, pastIds, previousId };
  const covering = cycles.find((c) => Date.parse(c.startsAt) <= start && start < Date.parse(c.endsAt));
  if (covering) {
    throw new Blocked('configuration_mismatch', `Cycle ${covering.id} 边界 ${covering.startsAt}–${covering.endsAt} 不等于当周`);
  }
  throw new Blocked('cycle_missing', `没有 ${week.start}–${week.end} 的 Cycle`);
}

// --------------------------------------------------------------------------
// 计划：身份分组与纳入目标
// --------------------------------------------------------------------------

function reject(run, issueId, code, message) {
  run.items.push({ issueId, action: 'unchanged', write: 'failed', delivery: null });
  run.problems.push({ code, issueId, message });
}

function groupMMFs(issues, run) {
  const mmfs = new Map(issues.filter((i) => i.specRef).map((i) => [i.id, { parent: i, tickets: [] }]));
  const epics = new Set([...mmfs.values()].map((m) => m.parent.parentId).filter(Boolean));
  for (const issue of issues.filter((i) => !i.specRef)) {
    const mmf = mmfs.get(issue.parentId);
    if (mmf) mmf.tickets.push(issue);
    else if (issue.statusType === 'started' && !epics.has(issue.id)) {
      reject(run, issue.id, 'identity_unverifiable', '无原 Spec 引用，也不属于已核实的 MMF 父项');
    }
  }
  return [...mmfs.values()];
}

// 仍需工作：进行中，或停在上一周期／本周 Cycle 且未完成
function needsWork(issue, held) {
  return issue.statusType === 'started' || (held.has(issue.cycleId) && !DONE_TYPES.has(issue.statusType));
}

// 相关 MMF：父项或 ticket 仍需工作，或父项停在上一周期／本周 Cycle（含已完成，供结转判断）
function candidateMembers({ parent, tickets }, labelId, held) {
  if (parent.labels.includes(labelId)) return [];
  const live = tickets.filter((t) => needsWork(t, held));
  const relevant = needsWork(parent, held) || held.has(parent.cycleId) || live.length > 0;
  return relevant ? [parent, ...live.filter((t) => !t.labels.includes(labelId))] : [];
}

// 归属：current = 本周 Cycle；outside = 本周开始前已交付，不得在本周；keep = 交付时间不可核实
function placement(delivery, weekStart) {
  if (delivery.status !== 'delivered') return 'current';
  if (delivery.effectiveAt === null) return 'keep';
  return Date.parse(delivery.effectiveAt) < Date.parse(weekStart) ? 'outside' : 'current';
}

function reportDrift(parent, delivery, run) {
  if (DRIFT[parent.statusType] !== delivery.status) return;
  run.problems.push({ code: 'workflow_drift', issueId: parent.id, message: `状态 ${parent.statusType} 与交付 ${delivery.status} 不符，交原 owner 核对` });
}

function keepAssignment(members, delivery, run) {
  for (const issue of members) run.items.push({ issueId: issue.id, action: 'unchanged', write: 'unknown', delivery });
  run.problems.push({ code: 'delivery_time_unverifiable', issueId: members[0].id, message: '已正式交付但事件时间缺失，保持原归属' });
  return [];
}

function toTarget(issue, where, delivery, { cycleId, pastIds }) {
  if (where === 'outside') return { issueId: issue.id, action: 'not_carry', cycleId: null, delivery };
  return { issueId: issue.id, action: pastIds.has(issue.cycleId) ? 'carry' : 'include', cycleId, delivery };
}

async function planMMF(mmf, ctx, run) {
  const members = candidateMembers(mmf, ctx.labelId, ctx.held);
  if (!members.length) return [];
  const delivery = await readDelivery(ctx.evidence, mmf.parent, run);
  reportDrift(mmf.parent, delivery, run);
  const where = placement(delivery, run.week.start);
  if (where === 'keep') return keepAssignment(members, delivery, run);
  return members.map((issue) => toTarget(issue, where, delivery, ctx));
}

async function readDelivery(evidence, parent, run) {
  const input = await evidence.read({ issueId: parent.id, specRef: parent.specRef }).catch((err) => ({
    spec: { state: 'unknown', source: null, effectiveAt: null, reason: String(err?.message ?? err) },
    main: { state: 'unknown', source: null, effectiveAt: null, reason: String(err?.message ?? err) }
  }));
  const delivery = assessFormalDelivery(input);
  if (delivery.status === 'unknown') {
    run.problems.push({ code: 'evidence_unavailable', issueId: parent.id, message: '正式交付证据不足，保持 Unknown' });
  }
  return delivery;
}

async function planTargets(scope, { linear, evidence, pastIds, previousId }, run) {
  const listed = await callPort(() => readAllPages((c) => linear.listIssues(scope, c)), 'capability_unavailable');
  const inScope = listed.filter((i) => i.teamId === scope.teamId && i.projectId === scope.projectId);
  for (const issue of listed.filter((i) => !inScope.includes(i))) {
    reject(run, issue.id, 'scope_invalid', '返回的 Issue 不在授权团队／项目内，不写入');
  }
  const cycleId = run.week.cycleId;
  const ctx = { evidence, pastIds, cycleId, labelId: scope.exclusionLabelId, held: new Set([previousId, cycleId].filter(Boolean)) };
  const targets = [];
  for (const mmf of groupMMFs(inScope, run)) targets.push(...await planMMF(mmf, ctx, run));
  return targets;
}

// --------------------------------------------------------------------------
// 执行：逐项前读、最小 patch、回读
// --------------------------------------------------------------------------

function record(run, target, write, problem) {
  run.items.push({ issueId: target.issueId, action: target.action, write, delivery: target.delivery });
  if (write === 'verified') run.changed += 1;
  if (problem) run.problems.push({ ...problem, issueId: target.issueId });
}

async function writeCycle(linear, issueId, cycleId) {
  try {
    await linear.patchIssue(issueId, { cycle: cycleId });
    return null;
  } catch (err) {
    return err?.code === 'permission_denied' ? 'denied' : 'uncertain';
  }
}

// not_carry 目标（cycleId=null）只要求不在本周 Cycle，旧周历史归属保持不动
function fits(target, cycleId, currentId) {
  return target.cycleId === null ? cycleId !== currentId : cycleId === target.cycleId;
}

async function applyTarget(target, { linear, now }, run) {
  const cycleId = target.cycleId;
  const currentId = run.week.cycleId;
  if (shanghaiWeek(now()).start !== run.week.start) {
    throw new Blocked('cycle_expired', `维护途中跨过周一，停止 ${run.week.start} 周的后续写入`);
  }
  const before = await linear.readIssue(target.issueId).catch((err) => err);
  if (before instanceof Error || !before) {
    return record(run, target, 'failed', { code: PORT_CODES.has(before?.code) ? before.code : 'capability_unavailable', message: '前读失败' });
  }
  if (fits(target, before.cycleId, currentId)) return record(run, target, 'unchanged');
  const outcome = await writeCycle(linear, target.issueId, cycleId);
  if (outcome === 'denied') return record(run, target, 'failed', { code: 'permission_denied', message: 'cycle 写入被拒绝' });
  const after = await linear.readIssue(target.issueId).catch(() => null);
  if (after && fits(target, after.cycleId, currentId)) return record(run, target, 'verified');
  if (outcome === 'uncertain' || !after) {
    return record(run, target, 'unknown', { code: 'write_unknown', message: '写入或回读无法判定' });
  }
  return record(run, target, 'failed', { code: 'readback_mismatch', message: `回读 cycleId=${after.cycleId}` });
}

function finish({ blocked, week, changed, items, problems }) {
  const conforming = items.filter((i) => i.write === 'verified' || i.write === 'unchanged').length;
  let status = 'unsynchronized';
  if (!blocked && conforming === items.length) status = 'synchronized';
  else if (conforming > 0) status = 'partial';
  else if (items.some((i) => i.write === 'unknown')) status = 'unknown';
  return { status, week, changed, items, problems };
}
