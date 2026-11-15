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
//             DD-540 §3 待回写：readIssue 字段扩展、readLabel、配置字段名、pick_conflict；
//             §6 待 Root 确认：运行中途阻断且已有符合项时为 partial（见 maintainCurrentWeek L4 OUT）；
//             DD-541 验收句待回写：本周新出现的未开始兄弟不纳入，上一周期未完成 ticket 随已相关 MMF 结转
// L5
//   PARAM: now() → Date；Asia/Shanghai 固定 UTC+8（无夏令时），周 = 周一 00:00 起的左闭右开 7 天
//   PARAM: readCycleConfiguration → {cyclesEnabled, timezone, cycleDurationWeeks, cycleStartDay, cooldownWeeks}
//          cycleStartDay 采用 JS getDay 编号（1 = 周一）；缺字段、null 或 'unknown' 均视为无法核实
//   PARAM: listCycles / listIssues(scope, cursor) → {nodes, pageInfo: {hasNextPage, endCursor}}；
//          hasNextPage 为真而 endCursor 为空或未前进 = capability_unavailable（不死循环、不截断）
//   PARAM: Issue → {id, teamId, projectId, statusType, labels, parentId, cycleId, specRef}
//          specRef 非空 = MMF 父 Spec Issue；其直接子项 = ticket；身份只看 id／parentId／specRef
//          specRef 来源 = to-spec 模板结构（owner：to-spec；映射见 linear-graphql.js L5），与层级无关
//          teamId、projectId、specRef 是对 Spec §3 readIssue 形状的扩展；缺 teamId／projectId → scope_invalid，零写入
//   PARAM: readLabel(labelId) → {id, teamId} | null；null、抛错或 teamId ≠ scope.teamId = 标记缺失
//   PARAM: patchIssue(issueId, {cycle?, addLabels?, removeLabels?}) 增量语义，未出现的字段不变；
//          响应体，只作声称：{success: true} 且无 errors = accepted；
//          errors 非空或 success=false = rejected；空体、其他形状或不带 FAIL code 的抛错 = uncertain
//   PARAM: readIssue → Issue；null、抛错、缺 cycleId 字段或 labels 非数组 = 不可读（cycleId: null 是合法事实）
//   FAIL: port 抛出带 code 的错误，code ∈ {permission_denied, capability_unavailable} 原样上报；
//         patchIssue 抛出这两类 code 为确定失败，该项 failed，不归 write_unknown
//   PAIR: 真实 Adapter = repo://skills/delivery-cycle/scripts/linear-graphql.js（LinearPort）、
//         repo://skills/delivery-cycle/scripts/evidence.js（EvidencePort）；CLI 装配在 scripts/run.js
//   PARAM: Evidence 来源 = 原 owner 事实：main = Spec Issue 唯一 PR 的合入读回，spec = 原验收评论快照回读
//          （映射见 evidence.js L5）；不认任何 delivery-cycle 自建标记
//   PARAM: Evidence 形状不合法，或 verified／not_met 缺 source → 该条件 unknown（evidence_unavailable）；
//          effectiveAt 须带时区，且日期部分是真实日历日（2026-02-30 → null）
// ==========================================================================

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const PORT_FAILURE = Object.freeze({ permission_denied: '写入被拒绝', capability_unavailable: '写入能力不可用' });
const PORT_CODES = new Set(Object.keys(PORT_FAILURE));
const DONE_TYPES = new Set(['completed', 'canceled']);
const EVIDENCE_STATES = new Set(['verified', 'not_met', 'unknown']);
// ISO 8601 日期时间，必须带时区；其余形状（数字、本地格式、'garbage'）都不是可核实的事件时间
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
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
//        其余 unknown；形状不合法或 verified／not_met 缺 source 的条件先降为 unknown；effectiveAt 仅在 delivered 且两时间齐全时取较晚值，否则 null；
//        不存在的日历日期（如 2026-02-30）按时间缺失处理
//   INVARIANT: 不读 Linear 状态，不改输入，不产生写入
//   TEST: tests/assessment.test.js（九组合）、tests/carryover.test.js（与维护入口同一结果）
// ==========================================================================
export function assessFormalDelivery(input) {
  const spec = checkedEvidence(input?.spec);
  const main = checkedEvidence(input?.main);
  const status = deliveryStatus(spec.state, main.state);
  const effectiveAt = status === 'delivered' ? laterOf(spec.effectiveAt, main.effectiveAt) : null;
  return { status, spec, main, effectiveAt };
}

// 形状不合法，或 verified／not_met 没有来源 → 该条件降为 unknown；无来源的结论不是证据；
// effectiveAt 不是可解析的 ISO 8601 字符串 → null（交付时间不可核实）
function checkedEvidence(evidence) {
  if (!EVIDENCE_STATES.has(evidence?.state)) {
    return { state: 'unknown', source: null, effectiveAt: null, reason: '证据形状不合法' };
  }
  const checked = { ...evidence, effectiveAt: instantOrNull(evidence.effectiveAt) };
  if (checked.state === 'unknown' || checked.source) return checked;
  return { ...checked, state: 'unknown', reason: `${checked.state} 缺来源` };
}

function instantOrNull(value) {
  const valid = typeof value === 'string' && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
  return valid && realDate(value.slice(0, 10)) ? value : null;
}

// Date.parse 会把不存在的日期（2026-02-30）滚到下月：日期部分按 UTC 回写，必须与原文前 10 位相同
function realDate(day) {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(day);
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
//        unknown：未被阻断、无符合项且至少一项 write_unknown；unsynchronized：其余
//        被阻断：有符合项 → partial，否则 unsynchronized；当前项与未处理项都列入 items（unchanged／failed）
//        configuration_unverifiable 时仍读一次 Cycle：观察到非 7 天 Cycle 另列 configuration_mismatch（只陈述长度，不补猜字段）
//        剔除／恢复阶段阻断时纳入计划尚未生成：items 只含已处理与未处理的剔除／恢复目标，纳入项不列入
//        「符合项」只算有写入目标的项；只观察的项（未来 Cycle 的 deferred、不相关 MMF 的 leftover、
//        未清出的 stray）记 unchanged／unchanged 可见，但不计为符合，也不阻止 synchronized
//        运行中途 cycle_missing／configuration_mismatch 且已有符合项 → partial（部分写入已真实落地，
//        报 unsynchronized 会误导重试判断）；入口即阻断 → unsynchronized。此口径待 Root 在 Spec §6 确认
//   INVARIANT: changed 只计回读确认的变更；patch 只含 cycle 与排除标签增减；scope 外对象零写入；
//              不读写原开发资格／依赖／派发／预算／恢复／授权，结果不含 gate 指令
//   INVARIANT: 不写 status／state；旧周 Cycle 历史不改；not_carry 只把本周 Cycle 改为 null
//   INVARIANT: 剔除只存在于 Linear 标签；父 MMF 标记派生到已核实子票，不复制；restore 只删目标自身标记
//   FAIL: 稳定 code 见 repo://docs/proposals/2026-11-14-delivery-cycle-m1-spec.md 第 6 节；
//         实现补充 pick_conflict（同一 ID 同时 exclude／restore，按 exclude 处理，只报告）
//   TEST: tests/configuration.test.js、tests/identity.test.js、tests/synchronization.test.js、
//         tests/recovery.test.js、tests/carryover.test.js、tests/exclusion.test.js
// L6
//   WHY: 无 CAS，只能逐项前读、最小 patch、业务字段回读，并如实报告观察到的事实
//   CHAIN: 配置核对 → 完整分页找当周、上一周期与未来 Cycle → 排除标签核对 → 完整分页 Issue → 身份分组 →
//          逐个 exclude／restore 选择 [前读 → 标签（及本周 cycle）增量 patch → 回读] →
//          已剔除、未完成且在本周的项清出本周 → 相关 MMF 每个读一次父项证据 →
//          按交付结论定归属（carry／include／not_carry／保持原归属） →
//          不相关 MMF 在本周有未完成 ticket 时单独读父项证据，只判清出（outside → not_carry） →
//          逐项 [重算当周 → 前读 → 重核当周、scope、身份、未来 Cycle → 重读目标 Cycle → 重判未来 Cycle →
//                patch → 回读 → 重核]
//   SCOPE: MMF 相关只由三项决定：父项仍需工作；父项在上一周期／本周 Cycle；存在不在未来 Cycle 的进行中 ticket。
//          过去 Cycle 中未完成的 ticket（含未开始的）只随已相关 MMF 结转，自身不让 MMF 相关，不相关时记 unchanged／unchanged；
//          更早 Cycle 中进行中的项按 R3 纳入；本周新建的未开始兄弟 ticket 不被纳入，也不拉父项；
//          父项已交付（outside）时，本周 Cycle 里未完成的 ticket 不论是否进行中都清出（not_carry）。
//          清出与纳入分开判定：MMF 不相关也照样清出，父项不纳入、不写；证据不是 outside 时不写，按证据规则报告；
//          未来 Cycle（startsAt ≥ 本周结束）的项是他人排期：先于纳入判断滤出，记 unchanged／unchanged，不写、不拉父项；
//          父项在未来 Cycle 而 ticket 已纳入本周 → 父项报 workflow_drift；显式剔除已完成项只加标记，不改 cycle
//   EXPIRE: cycle_expired 两类触发：上海时钟跨过周一；或计划时在目标 Cycle 的项，前读、写前重读或回读时
//           已在紧接的下一 Cycle。原生滚动与他人周中手动移动无法区分，都保守停止；该项 failed，
//           停止全部后续写入，绝不回移旧周。列表时已在未来 Cycle 的项不触发
//   BLOCK: 逐项阶段阻断时，当前项与全部未处理项记 action unchanged／write failed，只报一条阻断（issueId = 当前项）
//   STATE: deps.plan = {planned, futureIds, nextId} 是唯一可变计划上下文；写前重读刷新 futureIds／nextId，
//          当前项按前读值重判未来 Cycle
//   RECHECK: 写前重读目标 Cycle 边界不再等于当周 → configuration_mismatch；消失 → cycle_missing；都停止后续写入；
//            前读 teamId／projectId 离开 scope → scope_invalid；parentId／specRef 与计划不同 → identity_unverifiable；该项不写
//   DRIFT: 父项状态与交付冲突，父项本周前已交付而 ticket 仍进行中，或父项在未来 Cycle 而 ticket 已纳入本周
//          → workflow_drift（只报告）
//   LIMIT: 无 CAS；前读后、patch 前的未观察漂移只能由回读检出并报告，不能根除
//   CLASSIFY: 回读符合 → verified（不论响应声称）；声称 uncertain 或回读不可读 → unknown/write_unknown；
//             accepted 的 exclude 回读只剩 cycle 仍在本周 → native_assignment_conflict（保留标记）；
//             其余 accepted 但回读不符 → readback_mismatch；rejected 且回读不符 → write_failed
//   RETRY: 不保存上次结果；每次调用都是新维护，前读已符合即 unchanged，故 Unknown 后不重放、
//          partial 后只补仍必要项；已 verified 项从不回滚
//   HOLD: exclude／restore 未回读确认的项本次不再参与纳入计划；父项未定则整个 MMF 不动
//   PICK: 同一 ID 同时出现在 exclude 与 restore 时按 exclude 处理（保守保留剔除），并报 pick_conflict
//   TEST: tests/synchronization.test.js（漂移、跨周交错、原生滚动、回读不符、重复执行）；
//         tests/recovery.test.js（响应形态分类、partial／unknown 后重试、R12 隔离）；
//         tests/exclusion.test.js（持久剔除、父子边界恢复、原生冲突、标记缺失）
// ==========================================================================
export async function maintainCurrentWeek(request, { linear, evidence, now }) {
  const week = { ...shanghaiWeek(now()), cycleId: null };
  const run = { blocked: false, week, changed: 0, items: [], problems: [], pending: [], observed: new Set() };
  const { scope } = request;
  const deps = { linear, now, scope, labelId: scope.exclusionLabelId, plan: null };
  try {
    await maintain(request, deps, evidence, run);
  } catch (err) {
    if (!(err instanceof Blocked)) throw err;
    recordBlocked(run, err);
  }
  return finish(run);
}

// deps.plan = 本次计划上下文 {planned, futureIds, nextId}：planned 是列表时的 Issue 事实，
// futureIds／nextId 在每次写前重读 Cycle 时刷新；这是 deps 中唯一可变的部分
async function maintain(request, deps, evidence, run) {
  const { scope, linear, labelId } = deps;
  const { cycleId, ...cycles } = await findCurrentCycle(scope, linear, run.week);
  run.week.cycleId = cycleId;
  await verifyMarker(scope, linear);
  const listing = await listMMFs(scope, linear, run);
  deps.plan = { planned: listing.inScope, futureIds: cycles.futureIds, nextId: cycles.nextId };
  const skip = await applyPicks(request, listing, deps, run);
  const targets = await planTargets(listing.groups, { evidence, skip, cycleId, labelId, ...cycles }, run);
  await applyEach(targets, deps, run);
}

// 阻断：当前项与全部未处理项记 unchanged／failed；只报一条阻断，issueId 取当前项（阻断发生在逐项阶段时）
function recordBlocked(run, err) {
  run.blocked = true;
  for (const t of run.pending) run.items.push({ issueId: t.issueId, action: 'unchanged', write: 'failed', delivery: t.delivery });
  run.problems.push({ code: err.code, issueId: err.issueId ?? run.pending[0]?.issueId ?? null, message: err.message },
    ...(err.observed ?? []));
}

// 逐项执行；run.pending[0] 是当前项，处理完才出队，阻断时由 recordBlocked 记账
async function applyEach(targets, deps, run, onApplied = () => {}) {
  run.pending = [...targets];
  while (run.pending.length) {
    const target = run.pending[0];
    onApplied(target, await applyTarget(target, deps, run));
    run.pending.shift();
  }
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
    cursor = nextCursor(page.pageInfo, cursor);
  } while (cursor !== null);
  return nodes;
}

// 声称有下一页却给空游标或原地不动 → 无法完整读取，不能当作读完
function nextCursor({ hasNextPage, endCursor }, cursor) {
  if (!hasNextPage) return null;
  if (endCursor && endCursor !== cursor) return endCursor;
  throw Object.assign(new Error(`分页游标未前进：${endCursor}`), { code: 'capability_unavailable' });
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
  try {
    verifyConfiguration(config);
  } catch (err) {
    if (err.code === 'configuration_unverifiable') err.observed = await observedNonWeekly(scope, linear);
    throw err;
  }
  return readWeekCycles(scope, linear, week);
}

// 配置读不全时仍读一次 Cycle：观察到的非 7 天 Cycle 另列 configuration_mismatch；
// 只陈述观察到的长度，不据此补猜任何配置字段；Cycle 读不到时不加项
async function observedNonWeekly(scope, linear) {
  const cycles = await readAllPages((c) => linear.listCycles(scope, c)).catch(() => []);
  const days = (c) => (Date.parse(c.endsAt) - Date.parse(c.startsAt)) / DAY_MS;
  const odd = cycles.filter((c) => days(c) !== 7).map((c) => `${c.id}（${days(c)} 天）`);
  if (!odd.length) return [];
  return [{ code: 'configuration_mismatch', issueId: null, message: `观察到的 Cycle 不是单周：${odd.join(', ')}` }];
}

// 完整分页读 Cycle 并定位当周；入口与每项写入前都经这里（Spec §2：写前重读目标 Cycle）
async function readWeekCycles(scope, linear, week) {
  const cycles = await callPort(() => readAllPages((c) => linear.listCycles(scope, c)), 'capability_unavailable');
  const [start, end] = [Date.parse(week.start), Date.parse(week.end)];
  const ids = (keep) => new Set(cycles.filter(keep).map((c) => c.id));
  const exact = cycles.find((c) => Date.parse(c.startsAt) === start && Date.parse(c.endsAt) === end);
  if (!exact) throw missingWeek(cycles, week, start);
  return {
    cycleId: exact.id,
    pastIds: ids((c) => Date.parse(c.endsAt) <= start),
    futureIds: ids((c) => Date.parse(c.startsAt) >= end),
    previousId: cycles.find((c) => Date.parse(c.endsAt) === start)?.id ?? null,
    nextId: cycles.find((c) => Date.parse(c.startsAt) === end)?.id ?? null
  };
}

function missingWeek(cycles, week, start) {
  const covering = cycles.find((c) => Date.parse(c.startsAt) <= start && start < Date.parse(c.endsAt));
  if (covering) {
    return new Blocked('configuration_mismatch', `Cycle ${covering.id} 边界 ${covering.startsAt}–${covering.endsAt} 不等于当周`);
  }
  return new Blocked('cycle_missing', `没有 ${week.start}–${week.end} 的 Cycle`);
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

// 仍需工作：进行中，或停在任一过去 Cycle 且未完成（跳过几周不丢原工作）；本周 Cycle 里的未开始项不是纳入理由
function needsWork(issue, { pastIds }) {
  const leftOver = pastIds.has(issue.cycleId) && !DONE_TYPES.has(issue.statusType);
  return issue.statusType === 'started' || leftOver;
}

// 相关 MMF 只由三项决定：父项仍需工作、父项停在上一周期／本周 Cycle（含已完成，供结转判断）、
// 存在不在未来 Cycle 的进行中 ticket。过去 Cycle 中未开始的 ticket 只随已相关 MMF 结转，自身不让 MMF 相关；
// 不相关时记为 idle。未来 Cycle（startsAt ≥ 本周结束）的项是他人排期：不进入计划，只作为 deferred 可见
function candidateMembers({ parent, tickets }, ctx) {
  const later = (issue) => ctx.futureIds.has(issue.cycleId);
  const working = tickets.filter((t) => needsWork(t, ctx));
  const held = parent.cycleId !== null && [ctx.previousId, ctx.cycleId].includes(parent.cycleId);
  const live = working.some((t) => t.statusType === 'started' && !later(t));
  const relevant = needsWork(parent, ctx) || held || live;
  const deferred = [...(relevant ? [parent] : []), ...working].filter(later);
  const idle = relevant ? [] : working.filter((t) => !later(t));
  return { members: relevant ? [parent, ...working].filter((i) => !later(i)) : [], deferred, idle };
}

// 剔除边界：父项标记覆盖整个 MMF；子票标记只覆盖自身；skip（本次剔除／恢复未定）不参与任何计划
function splitExcluded({ parent, tickets }, { labelId, skip }) {
  if (skip.has(parent.id)) return { excluded: [], mmf: null };
  const marked = (issue) => issue.labels.includes(labelId);
  const kept = tickets.filter((t) => !skip.has(t.id));
  if (marked(parent)) return { excluded: [parent, ...kept], mmf: null };
  return { excluded: kept.filter(marked), mmf: { parent, tickets: kept.filter((t) => !marked(t)) } };
}

// 已剔除却在本周 Cycle（手工或原生加回）且未完成 → 清出本周；不在本周或已完成的不动
function evictions(excluded, cycleId) {
  return excluded.filter((i) => i.cycleId === cycleId && !DONE_TYPES.has(i.statusType))
    .map((i) => ({ issueId: i.id, action: 'exclude', cycleId: null, delivery: null }));
}

// 归属：current = 本周 Cycle；outside = 本周开始前已交付，不得在本周；keep = 交付时间不可核实
function placement(delivery, weekStart) {
  if (delivery.status !== 'delivered') return 'current';
  if (delivery.effectiveAt === null) return 'keep';
  return Date.parse(delivery.effectiveAt) < Date.parse(weekStart) ? 'outside' : 'current';
}

// 父项状态与交付冲突，或父项本周前已交付而 ticket 仍进行中 → workflow_drift；只报告，不改状态
function reportDrift(parent, members, delivery, where, run) {
  const drifted = DRIFT[parent.statusType] === delivery.status ? [parent] : [];
  if (where === 'outside') drifted.push(...members.filter((i) => i !== parent && i.statusType === 'started'));
  for (const issue of drifted) {
    run.problems.push({ code: 'workflow_drift', issueId: issue.id, message: `状态 ${issue.statusType} 与交付 ${delivery.status} 不符，交原 owner 核对` });
  }
}

function keepAssignment(members, delivery, run, parentId) {
  for (const issue of members) run.items.push({ issueId: issue.id, action: 'unchanged', write: 'unknown', delivery });
  run.problems.push({ code: 'delivery_time_unverifiable', issueId: parentId, message: '已正式交付但事件时间缺失，保持原归属' });
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
  const { members, deferred, idle } = candidateMembers(mmf, ctx);
  recordDeferred(deferred, members, mmf.parent, run);
  recordObserved(run, idle);
  if (!members.length) return planStrays(mmf, ctx, run);
  const delivery = await readDelivery(ctx.evidence, mmf.parent, run);
  const where = placement(delivery, run.week.start);
  const affected = where === 'outside' ? [...members, ...strays(mmf, members, ctx)] : members;
  reportDrift(mmf.parent, affected, delivery, where, run);
  if (where === 'keep') return keepAssignment(members, delivery, run, mmf.parent.id);
  return affected.map((issue) => toTarget(issue, where, delivery, ctx));
}

// 清出与纳入分开判定：不相关 MMF 在本周 Cycle 里有未完成 ticket 时单独读父项证据；
// outside → 这些 ticket not_carry；其余不写、保持原归属，按证据规则报告；父项不纳入、不写
async function planStrays(mmf, ctx, run) {
  const stray = strays(mmf, [], ctx);
  if (!stray.length) return [];
  const delivery = await readDelivery(ctx.evidence, mmf.parent, run);
  const where = placement(delivery, run.week.start);
  reportDrift(mmf.parent, stray, delivery, where, run);
  if (where === 'keep') return keepAssignment(stray, delivery, run, mmf.parent.id);
  if (where === 'outside') return stray.map((issue) => toTarget(issue, where, delivery, ctx));
  recordObserved(run, stray, delivery);
  return [];
}

// 只观察、本次没有写入目标的项：可见（unchanged／unchanged），但不计入已核实符合目标项
function recordObserved(run, issues, delivery = null) {
  for (const issue of issues) {
    const entry = { issueId: issue.id, action: 'unchanged', write: 'unchanged', delivery };
    run.items.push(entry);
    run.observed.add(entry);
  }
}

// 未来 Cycle 的项可见但不写；父项被排到未来而 ticket 已纳入本周 → 父项 workflow_drift
function recordDeferred(deferred, members, parent, run) {
  recordObserved(run, deferred);
  if (!members.length || !deferred.includes(parent)) return;
  run.problems.push({ code: 'workflow_drift', issueId: parent.id, message: '父项被排到未来 Cycle，ticket 已纳入本周，交原 owner 核对' });
}

// 已交付 MMF（outside）在本周 Cycle 里的未完成 ticket 不论是否仍需工作都要清出；已完成的不动
function strays({ tickets }, members, { cycleId }) {
  return tickets.filter((t) => t.cycleId === cycleId && !DONE_TYPES.has(t.statusType) && !members.includes(t));
}

async function readDelivery(evidence, parent, run) {
  const input = await evidence.read({ issueId: parent.id, specRef: parent.specRef }).catch((err) => ({
    spec: { state: 'unknown', source: null, effectiveAt: null, reason: String(err?.message ?? err) },
    main: { state: 'unknown', source: null, effectiveAt: null, reason: String(err?.message ?? err) }
  }));
  const delivery = assessFormalDelivery(input ?? {});
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
  return { groups: groupMMFs(inScope, run), inScope: new Map(inScope.map((i) => [i.id, i])) };
}

async function planTargets(groups, ctx, run) {
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
  reportPickConflicts(exclude, restore, run);
  const picks = new Map([...restore.map((id) => [id, 'restore']), ...exclude.map((id) => [id, 'exclude'])]);
  const members = new Map(groups.flatMap((g) => [g.parent, ...g.tickets]).map((i) => [i.id, i]));
  const reported = new Set(run.items.map((i) => i.issueId));
  for (const id of [...picks.keys()].filter((p) => !members.has(p) && !reported.has(p))) {
    if (inScope.has(id)) reject(run, id, 'identity_unverifiable', '选择的 Issue 不是已核实的 MMF 父项或 ticket');
    else reject(run, id, 'scope_invalid', '选择的 Issue 不在授权团队／项目内，不写入');
  }
  return [...picks].filter(([id]) => members.has(id)).map(([id, kind]) => [members.get(id), kind]);
}

// 同一 ID 两边都选：保守按 exclude 处理，并如实报告被忽略的 restore
function reportPickConflicts(exclude, restore, run) {
  for (const id of new Set(exclude.filter((e) => restore.includes(e)))) {
    run.problems.push({ code: 'pick_conflict', issueId: id, message: '同时出现在 exclude 与 restore，按 exclude 处理' });
  }
}

// 回读确认后用回读事实更新本次计划；未确认的项进入 skip
async function applyPicks(request, listing, deps, run) {
  const skip = new Set();
  const picked = new Map(verifiedPicks(request, listing, run).map(([issue, kind]) => [issue.id, [issue, kind]]));
  const targets = [...picked.values()].map(([issue, kind]) => pickTarget(issue, kind));
  await applyEach(targets, deps, run, (target, read) => {
    if (read) Object.assign(picked.get(target.issueId)[0], { labels: read.labels, cycleId: read.cycleId });
    else skip.add(target.issueId);
  });
  return skip;
}

// 已完成项的剔除只加标记，不动 cycle（与已完成 ticket 不清出一致）
function pickTarget(issue, kind) {
  const target = { issueId: issue.id, delivery: null, ...PICK_TARGET[kind] };
  if (kind === 'exclude' && DONE_TYPES.has(issue.statusType)) target.cycleId = undefined;
  return target;
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

// port 明确的失败 code 原样作为声称返回；其他抛错（超时等）为 uncertain，交回读分类
async function writePatch(linear, issueId, patch) {
  try {
    return patchClaim(await linear.patchIssue(issueId, patch));
  } catch (err) {
    return PORT_CODES.has(err?.code) ? err.code : 'uncertain';
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
  const native = claim === 'accepted' && action === 'exclude' && Object.keys(remaining).join() === 'cycle';
  if (native) return ['failed', { code: 'native_assignment_conflict', message: `清空后回读仍在 ${after.cycleId}；保留剔除标记` }];
  return ['failed', { code: MISMATCH_CODE[claim], message: `回读 cycleId=${after.cycleId}，labels=${after.labels}` }];
}

// 返回回读确认的 Issue（unchanged 为前读）；失败、未知或不处理返回 null
async function applyTarget(target, deps, run) {
  const before = await preRead(target, deps, run);
  if (!before) return null;
  const patch = patchFor(target, before, factsOf(deps, run));
  if (!Object.keys(patch).length) return record(run, target, 'unchanged') ?? before;
  await recheckWeek(deps, run);
  if (scheduledLater(target, before, deps, run)) return skipLater(run, target);
  const claim = await writePatch(deps.linear, target.issueId, patch);
  if (PORT_FAILURE[claim]) return record(run, target, 'failed', { code: claim, message: PORT_FAILURE[claim] });
  return readBack(target, before, claim, deps, run);
}

const factsOf = ({ labelId }, run) => ({ currentId: run.week.cycleId, labelId });

// 前读：重算当周 → 读 Issue → 重核当周、scope 与身份 → 未来 Cycle 判定
async function preRead(target, deps, run) {
  ensureClock(deps, run);
  const before = await readState(deps.linear, target.issueId);
  if ('unreadable' in before) return recordUnreadable(run, target, before.unreadable);
  ensureClock(deps, run);
  const drift = identityDrift(before, deps);
  if (drift) return record(run, target, 'failed', drift);
  return scheduledLater(target, before, deps, run) ? skipLater(run, target) : before;
}

// 计划时在目标 Cycle、现已在紧接的下一 Cycle → 目标已过期：原生滚动与他人周中手动移动无法区分，
// 都保守停止（cycle_expired）；其余未来 Cycle 中的纳入目标是他人排期 → true（不写、不报失败）
function scheduledLater(target, issue, { plan }, run) {
  const wasCurrent = plan.planned.get(target.issueId)?.cycleId === run.week.cycleId;
  if (wasCurrent && inNextCycle(plan, issue)) throw expired('目标 Cycle 的项已移入下一 Cycle');
  return target.cycleId === run.week.cycleId && plan.futureIds.has(issue.cycleId);
}

const inNextCycle = ({ nextId }, issue) => nextId !== null && issue.cycleId === nextId;
// 前读才发现的他人排期：与 deferred 同义，可见但不计入符合项
function skipLater(run, target) {
  record(run, { ...target, action: 'unchanged' }, 'unchanged');
  run.observed.add(run.items.at(-1));
  return null;
}
const expired = (why) => new Blocked('cycle_expired', `${why}，停止旧周的后续写入，绝不回移`);

function identityDrift(issue, { scope, plan }) {
  if (issue.teamId !== scope.teamId || issue.projectId !== scope.projectId) {
    return { code: 'scope_invalid', message: '前读时已不在授权团队／项目内，不写入' };
  }
  const was = plan.planned.get(issue.id);
  if (issue.parentId === was?.parentId && issue.specRef === was?.specRef) return null;
  return { code: 'identity_unverifiable', message: '前读时父子关系或 Spec 引用已变，不写入' };
}

// 写前重读目标 Cycle：边界不再等于当周 → configuration_mismatch，消失 → cycle_missing，都停止后续写入；
// 刷新 plan.futureIds／nextId，供当前项按前读值重判未来 Cycle
async function recheckWeek(deps, run) {
  const fresh = await readWeekCycles(deps.scope, deps.linear, run.week);
  if (fresh.cycleId !== run.week.cycleId) {
    throw new Blocked('configuration_mismatch', `当周 Cycle 已由 ${run.week.cycleId} 变为 ${fresh.cycleId}`);
  }
  Object.assign(deps.plan, { futureIds: fresh.futureIds, nextId: fresh.nextId });
  ensureClock(deps, run);
}

// 回读：时钟跨周，或本次写入后项进入紧接的下一 Cycle（前读时不在）→ cycle_expired
async function readBack(target, before, claim, deps, run) {
  const after = await readState(deps.linear, target.issueId);
  const readable = !('unreadable' in after);
  if (readable) ensureClock(deps, run);
  if (readable && inNextCycle(deps.plan, after) && !inNextCycle(deps.plan, before)) throw expired('写入后回读已在下一 Cycle');
  const remaining = readable ? patchFor(target, after, factsOf(deps, run)) : null;
  const [write, problem] = classifyReadback(claim, after, remaining, target.action);
  return record(run, target, write, problem) ?? (write === 'verified' ? after : null);
}

// 时钟触发的过期：上海时钟已跨过周一 00:00
function ensureClock({ now }, run) {
  if (shanghaiWeek(now()).start !== run.week.start) throw expired(`维护途中跨过周一（${run.week.start} 周）`);
}

function recordUnreadable(run, target, cause) {
  const code = PORT_CODES.has(cause?.code) ? cause.code : 'capability_unavailable';
  return record(run, target, 'failed', { code, message: '前读失败，本项不写' });
}

// 被阻断：有符合项 → partial，否则 unsynchronized（write unknown 不改变阻断结论）；
// observed 项（deferred、idle、未清出的 stray）可见但不算已核实符合目标项，也不阻止 synchronized
function finish({ blocked, week, changed, items, problems, observed }) {
  const targeted = items.filter((i) => !observed.has(i));
  const conforming = targeted.filter((i) => i.write === 'verified' || i.write === 'unchanged').length;
  let status = 'unsynchronized';
  if (!blocked && conforming === targeted.length) status = 'synchronized';
  else if (conforming > 0) status = 'partial';
  else if (!blocked && targeted.some((i) => i.write === 'unknown')) status = 'unknown';
  return { status, week, changed, items, problems };
}
