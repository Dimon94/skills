// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/delivery-cycle.js
//   INPUT: LinearPort（Cycle 配置、Cycle、排除标签、Issue 读写）；EvidencePort（原 Spec／closeout 证据）；now()
//   OUTPUT: assessFormalDelivery、maintainCurrentWeek；唯一写入是 LinearPort.patchIssue 的
//           cycle 与专用排除标签增减（addLabels／removeLabels）
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
//   PARAM: readLabel(labelId) → {id, teamId} | null；null、抛错或 teamId ≠ scope.teamId = 标记缺失
//   PARAM: patchIssue(issueId, {cycle?, addLabels?, removeLabels?}) 增量语义，未出现的字段不变；
//          响应体，只作声称：{success: true} 且无 errors = accepted；
//          errors 非空或 success=false = rejected；空体、其他形状或非 permission_denied 抛错 = uncertain
//   PARAM: readIssue → Issue；null、抛错、缺 cycleId 字段或 labels 非数组 = 不可读（cycleId: null 是合法事实）
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
  constructor(code, message, issueId = null) {
    super(message);
    this.code = code;
    this.issueId = issueId;
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
//   INVARIANT: changed 只计回读确认的变更；patch 只含 cycle 与排除标签增减；scope 外对象零写入；
//              不读写原开发资格／依赖／派发／预算／恢复／授权，结果不含 gate 指令
//   INVARIANT: 不写 status／state；旧周 Cycle 历史不改；not_carry 只把本周 Cycle 改为 null
//   INVARIANT: 剔除只存在于 Linear 标签；父 MMF 标记派生到已核实子票，不复制；restore 只删目标自身标记
//   FAIL: 稳定 code 见 repo://docs/proposals/2026-11-14-delivery-cycle-m1-spec.md 第 6 节
//   TEST: tests/configuration.test.js、tests/identity.test.js、tests/synchronization.test.js、
//         tests/recovery.test.js、tests/carryover.test.js、tests/exclusion.test.js
// L6
//   WHY: 无 CAS，只能逐项前读、最小 patch、业务字段回读，并如实报告观察到的事实
//   CHAIN: 配置核对 → 完整分页找当周与上一周期 Cycle → 排除标签核对 → 完整分页 Issue → 身份分组 →
//          逐个 exclude／restore 选择 [前读 → 标签（及本周 cycle）增量 patch → 回读] →
//          已剔除且在本周的项清出本周 → 其余每 MMF 读一次父项证据 → 按交付结论定归属（carry／include／not_carry／保持原归属） →
//          逐项 [重算当周 → 前读 → 重核 → patch → 回读 → 重核]；
//          时钟跨过周一，或纳入目标在前读／回读时已位于下一周 Cycle（原生滚动）→ 该项 failed、
//          cycle_expired 并停止旧周全部后续写入；已观察到新周归属的项绝不回移旧周
//   LIMIT: 无 CAS；前读后、patch 前的未观察漂移只能由回读检出并报告，不能根除
//   CLASSIFY: 回读符合 → verified（不论响应声称）；声称 uncertain 或回读不可读 → unknown/write_unknown；
//             exclude 回读只剩 cycle 仍在本周 → native_assignment_conflict（保留标记）；
//             其余 accepted 但回读不符 → readback_mismatch；rejected 且回读不符 → write_failed
//   RETRY: 不保存上次结果；每次调用都是新维护，前读已符合即 unchanged，故 Unknown 后不重放、
//          partial 后只补仍必要项；已 verified 项从不回滚
//   HOLD: exclude／restore 未回读确认的项本次不再参与纳入计划；父项未定则整个 MMF 不动
//   PICK: 同一 ID 同时出现在 exclude 与 restore 时按 exclude 处理（保守保留剔除）
//   TEST: tests/synchronization.test.js（漂移、跨周交错、原生滚动、回读不符、重复执行）；
//         tests/recovery.test.js（响应形态分类、partial／unknown 后重试、R12 隔离）；
//         tests/exclusion.test.js（持久剔除、父子边界恢复、原生冲突、标记缺失）
// ==========================================================================
export async function maintainCurrentWeek(request, { linear, evidence, now }) {
  const run = { blocked: false, week: { ...shanghaiWeek(now()), cycleId: null }, changed: 0, items: [], problems: [] };
  const { scope } = request;
  const deps = { linear, now, labelId: scope.exclusionLabelId };
  try {
    const { cycleId, nextId, ...cycles } = await findCurrentCycle(scope, linear, run.week);
    run.week.cycleId = cycleId;
    deps.nextId = nextId;
    await verifyMarker(scope, linear);
    const listing = await listMMFs(scope, linear, run);
    const skip = await applyPicks(request, listing, deps, run);
    const targets = await planTargets(listing.groups, { evidence, skip, cycleId, labelId: deps.labelId, ...cycles }, run);
    for (const target of targets) await applyTarget(target, deps, run);
  } catch (err) {
    if (!(err instanceof Blocked)) throw err;
    run.blocked = true;
    run.problems.push({ code: err.code, issueId: err.issueId, message: err.message });
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
  const nextId = cycles.find((c) => Date.parse(c.startsAt) === Date.parse(week.end))?.id ?? null;
  if (exact) return { cycleId: exact.id, pastIds, previousId, nextId };
  const covering = cycles.find((c) => Date.parse(c.startsAt) <= start && start < Date.parse(c.endsAt));
  if (covering) {
    throw new Blocked('configuration_mismatch', `Cycle ${covering.id} 边界 ${covering.startsAt}–${covering.endsAt} 不等于当周`);
  }
  throw new Blocked('cycle_missing', `没有 ${week.start}–${week.end} 的 Cycle`);
}

// 排除标签是剔除的唯一持久载体；不可核实时整体零写入，不用本地列表替代
async function verifyMarker(scope, linear) {
  const label = await callPort(() => linear.readLabel(scope.exclusionLabelId), 'exclusion_marker_missing');
  if (label?.id !== scope.exclusionLabelId || label.teamId !== scope.teamId) {
    throw new Blocked('exclusion_marker_missing', `团队 ${scope.teamId} 没有可核实的排除标签 ${scope.exclusionLabelId}`);
  }
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
function candidateMembers({ parent, tickets }, held) {
  const live = tickets.filter((t) => needsWork(t, held));
  const relevant = needsWork(parent, held) || held.has(parent.cycleId) || live.length > 0;
  return relevant ? [parent, ...live] : [];
}

// 剔除边界：父项标记覆盖整个 MMF；子票标记只覆盖自身；skip（本次剔除／恢复未定）不参与任何计划
function splitExcluded({ parent, tickets }, { labelId, skip }) {
  if (skip.has(parent.id)) return { excluded: [], mmf: null };
  const marked = (issue) => issue.labels.includes(labelId);
  const kept = tickets.filter((t) => !skip.has(t.id));
  if (marked(parent)) return { excluded: [parent, ...kept], mmf: null };
  return { excluded: kept.filter(marked), mmf: { parent, tickets: kept.filter((t) => !marked(t)) } };
}

// 已剔除却在本周 Cycle（手工或原生加回）→ 清出本周；不在本周的不动
function evictions(excluded, cycleId) {
  return excluded.filter((i) => i.cycleId === cycleId)
    .map((i) => ({ issueId: i.id, action: 'exclude', cycleId: null, delivery: null }));
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

async function planMMF(group, ctx, run) {
  const { excluded, mmf } = splitExcluded(group, ctx);
  return [...evictions(excluded, ctx.cycleId), ...(mmf ? await planIncluded(mmf, ctx, run) : [])];
}

async function planIncluded(mmf, ctx, run) {
  const members = candidateMembers(mmf, ctx.held);
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

async function listMMFs(scope, linear, run) {
  const listed = await callPort(() => readAllPages((c) => linear.listIssues(scope, c)), 'capability_unavailable');
  const inScope = listed.filter((i) => i.teamId === scope.teamId && i.projectId === scope.projectId);
  for (const issue of listed.filter((i) => !inScope.includes(i))) {
    reject(run, issue.id, 'scope_invalid', '返回的 Issue 不在授权团队／项目内，不写入');
  }
  return { groups: groupMMFs(inScope, run), inScope: new Set(inScope.map((i) => i.id)) };
}

async function planTargets(groups, { previousId, ...rest }, run) {
  const ctx = { ...rest, held: new Set([previousId, rest.cycleId].filter(Boolean)) };
  const targets = [];
  for (const group of groups) targets.push(...await planMMF(group, ctx, run));
  return targets;
}

// --------------------------------------------------------------------------
// 显式选择：exclude 加标记（在本周时同时清 cycle），restore 只删目标自身标记
// --------------------------------------------------------------------------

const PICK_TARGET = Object.freeze({
  exclude: { action: 'exclude', cycleId: null, marked: true },
  restore: { action: 'restore', cycleId: undefined, marked: false }
});

// 未核实身份或不在范围内的选择零写入；已在列表阶段报告过的不重复报告
function verifiedPicks({ exclude = [], restore = [] }, { groups, inScope }, run) {
  const picks = new Map([...restore.map((id) => [id, 'restore']), ...exclude.map((id) => [id, 'exclude'])]);
  const members = new Map(groups.flatMap((g) => [g.parent, ...g.tickets]).map((i) => [i.id, i]));
  const reported = new Set(run.items.map((i) => i.issueId));
  for (const id of [...picks.keys()].filter((p) => !members.has(p) && !reported.has(p))) {
    if (inScope.has(id)) reject(run, id, 'identity_unverifiable', '选择的 Issue 不是已核实的 MMF 父项或 ticket');
    else reject(run, id, 'scope_invalid', '选择的 Issue 不在授权团队／项目内，不写入');
  }
  return [...picks].filter(([id]) => members.has(id)).map(([id, kind]) => [members.get(id), kind]);
}

// 回读确认后用回读事实更新本次计划；未确认的项进入 skip
async function applyPicks(request, listing, deps, run) {
  const skip = new Set();
  for (const [issue, kind] of verifiedPicks(request, listing, run)) {
    const target = { issueId: issue.id, delivery: null, ...PICK_TARGET[kind] };
    const read = await applyTarget(target, deps, run);
    if (read) Object.assign(issue, { labels: read.labels, cycleId: read.cycleId });
    else skip.add(issue.id);
  }
  return skip;
}

// --------------------------------------------------------------------------
// 执行：逐项前读、最小 patch、回读
// --------------------------------------------------------------------------

function record(run, target, write, problem) {
  run.items.push({ issueId: target.issueId, action: target.action, write, delivery: target.delivery });
  if (write === 'verified') run.changed += 1;
  if (problem) run.problems.push({ ...problem, issueId: target.issueId });
  return null;
}

// mutation 响应只是平台的声称：accepted／rejected／uncertain；结论一律以回读为准
function patchClaim(response) {
  if (!response || typeof response !== 'object') return 'uncertain';
  if (response.errors?.length || response.success === false) return 'rejected';
  return response.success === true ? 'accepted' : 'uncertain';
}

async function writePatch(linear, issueId, patch) {
  try {
    return patchClaim(await linear.patchIssue(issueId, patch));
  } catch (err) {
    return err?.code === 'permission_denied' ? 'denied' : 'uncertain';
  }
}

// 读不到 Issue、缺 cycleId 字段或 labels 非数组都算不可读；cycleId = null 是合法事实
async function readState(linear, issueId) {
  const issue = await linear.readIssue(issueId).catch((err) => err);
  const readable = !(issue instanceof Error) && issue?.cycleId !== undefined && Array.isArray(issue?.labels);
  return readable ? issue : { unreadable: issue };
}

// 目标与现状的差 = 最小增量 patch；空 patch 即符合。
// cycleId: undefined 不约束；null 只要求不在本周（旧周历史不动）；marked: undefined 不约束标签
function patchFor(target, issue, { currentId, labelId }) {
  const patch = {};
  const inCycle = target.cycleId === null ? issue.cycleId !== currentId : issue.cycleId === target.cycleId;
  if (target.cycleId !== undefined && !inCycle) patch.cycle = target.cycleId;
  const marked = issue.labels.includes(labelId);
  if (target.marked === true && !marked) patch.addLabels = [labelId];
  if (target.marked === false && marked) patch.removeLabels = [labelId];
  return patch;
}

const MISMATCH_CODE = { accepted: 'readback_mismatch', rejected: 'write_failed' };

// remaining = 回读后仍需的 patch；null 表示回读不可读
function classifyReadback(claim, after, remaining, action) {
  if (remaining && !Object.keys(remaining).length) return ['verified'];
  if (claim === 'uncertain' || !remaining) {
    return ['unknown', { code: 'write_unknown', message: '写入或回读无法判定；下次先回读，不重放' }];
  }
  const native = action === 'exclude' && Object.keys(remaining).join() === 'cycle';
  if (native) return ['failed', { code: 'native_assignment_conflict', message: `清空后回读仍在 ${after.cycleId}；保留剔除标记` }];
  return ['failed', { code: MISMATCH_CODE[claim], message: `回读 cycleId=${after.cycleId}，labels=${after.labels}` }];
}

// 返回回读确认的 Issue（unchanged 为前读）；失败或未知返回 null
async function applyTarget(target, deps, run) {
  const { linear, labelId } = deps;
  const facts = { currentId: run.week.cycleId, labelId };
  ensureWeek(deps, run);
  const before = await readState(linear, target.issueId);
  if ('unreadable' in before) return recordUnreadable(run, target, before.unreadable);
  ensureWeek(deps, run, target, before);
  const patch = patchFor(target, before, facts);
  if (!Object.keys(patch).length) return record(run, target, 'unchanged') ?? before;
  const claim = await writePatch(linear, target.issueId, patch);
  if (claim === 'denied') return record(run, target, 'failed', { code: 'permission_denied', message: '写入被拒绝' });
  const after = await readState(linear, target.issueId);
  if (!('unreadable' in after)) ensureWeek(deps, run, target, after);
  const remaining = 'unreadable' in after ? null : patchFor(target, after, facts);
  const [write, problem] = classifyReadback(claim, after, remaining, target.action);
  return record(run, target, write, problem) ?? (write === 'verified' ? after : null);
}

// 当周已过期的证据：时钟跨过周一，或纳入目标的 Issue 已被观察到在下一周 Cycle（原生滚动）。
// 任一成立即记该项 failed 并停止全部后续写入；已观察到新周归属的项绝不回移旧周
function ensureWeek({ now, nextId }, run, target = null, issue = null) {
  const crossed = shanghaiWeek(now()).start !== run.week.start;
  const rolled = target?.cycleId === run.week.cycleId && nextId !== null && issue?.cycleId === nextId;
  if (!crossed && !rolled) return;
  if (target) record(run, target, 'failed');
  const reason = rolled ? `已观察到 ${target.issueId} 在新周 Cycle ${nextId}` : '维护途中跨过周一';
  throw new Blocked('cycle_expired', `${reason}，停止 ${run.week.start} 周的后续写入`, target?.issueId ?? null);
}

function recordUnreadable(run, target, cause) {
  const code = PORT_CODES.has(cause?.code) ? cause.code : 'capability_unavailable';
  return record(run, target, 'failed', { code, message: '前读失败，本项不写' });
}

function finish({ blocked, week, changed, items, problems }) {
  const conforming = items.filter((i) => i.write === 'verified' || i.write === 'unchanged').length;
  let status = 'unsynchronized';
  if (!blocked && conforming === items.length) status = 'synchronized';
  else if (conforming > 0) status = 'partial';
  else if (items.some((i) => i.write === 'unknown')) status = 'unknown';
  return { status, week, changed, items, problems };
}
