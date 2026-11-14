// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/linear-graphql.js
//   INPUT: request(query, variables) → Promise<GraphQL 响应体 {data?, errors?}>；
//          默认 transport 从 macOS 钥匙串读 Linear API key（service refresh-linear-api-key）
//   OUTPUT: createLinearAdapter（LinearPort 实现）、createKeychainTransport
//   POS: LinearPort 唯一真实 Adapter；只做 GraphQL 形状与错误码转换，不做周期判断
//   TEST: node --test skills/delivery-cycle/tests/linear-graphql.test.js
//   PROTOCOL: LinearPort 形状以 repo://skills/delivery-cycle/scripts/delivery-cycle.js 的 L5 为准
// L5
//   PARAM: readCycleConfiguration：Team.cycleDuration、cycleCooldownTime 单位为周，映射为
//          cycleDurationWeeks、cooldownWeeks；cycleStartDay 与 JS getDay 同编号（1 = 周一）；
//          另带 cycleLockToActive、cycleIssueAutoAssignStarted、cycleIssueAutoAssignCompleted 原值；缺字段 = null
//   PARAM: listIssues 过滤 team.id eq 且 project.id eq；每页 50；标签超过一页 = capability_unavailable
//   PARAM: specRef（推断，待根协调者确认）：有父项且有子项的 Issue = 父 Spec Issue，specRef = 自身 identifier；
//          其余为 null。依据 docs/agents/issue-tracker.md 的 Epic → Spec → ticket 结构；不看标题
//   PARAM: patchIssue 只发 cycleId／addedLabelIds／removedLabelIds 中出现的字段；永不发 labelIds
//   FAIL: HTTP 401／403，或 errors 含 AUTHENTICATION_ERROR、FORBIDDEN、Invalid scope = permission_denied（读写一致）
//   FAIL: 读：其余 GraphQL errors 或响应形状不明 = capability_unavailable；readLabel 遇 Entity not found = null
//   FAIL: 写：其余 GraphQL errors 原样返回 {errors}（核心判 rejected）；网络错误原样抛出（核心判 uncertain）
//   FAIL: 钥匙串读不到 key = permission_denied；key 不进入任何错误文本或日志
// ==========================================================================

import { execFile as execFileCb } from 'node:child_process';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';

const ENDPOINT = 'https://api.linear.app/graphql';
const KEYCHAIN_SERVICE = 'refresh-linear-api-key';
const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 50;
const DENIAL = /AUTHENTICATION_ERROR|FORBIDDEN|Invalid scope/i;

const ISSUE_FIELDS = `fragment DeliveryCycleIssueFields on Issue {
  id identifier team { id } project { id } state { type } cycle { id } parent { id }
  labels(first: ${PAGE_SIZE}) { nodes { id } pageInfo { hasNextPage } }
  children(first: 1) { nodes { id } }
}`;

const QUERIES = Object.freeze({
  team: `query DeliveryCycleTeam($id: String!) { team(id: $id) {
    cyclesEnabled timezone cycleDuration cycleStartDay cycleCooldownTime
    cycleLockToActive cycleIssueAutoAssignStarted cycleIssueAutoAssignCompleted } }`,
  cycles: `query DeliveryCycleCycles($filter: CycleFilter, $after: String) {
    cycles(filter: $filter, after: $after, first: ${PAGE_SIZE}) {
      nodes { id startsAt endsAt } pageInfo { hasNextPage endCursor } } }`,
  issues: `query DeliveryCycleIssues($filter: IssueFilter, $after: String) {
    issues(filter: $filter, after: $after, first: ${PAGE_SIZE}) {
      nodes { ...DeliveryCycleIssueFields } pageInfo { hasNextPage endCursor } } }
  ${ISSUE_FIELDS}`,
  issue: `query DeliveryCycleIssue($id: String!) { issue(id: $id) { ...DeliveryCycleIssueFields } }
  ${ISSUE_FIELDS}`,
  label: `query DeliveryCycleLabel($id: String!) { issueLabel(id: $id) { id team { id } } }`,
  update: `mutation DeliveryCycleUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) { success } }`
});

const CONFIG_FIELDS = Object.freeze({
  cyclesEnabled: 'cyclesEnabled',
  timezone: 'timezone',
  cycleDurationWeeks: 'cycleDuration',
  cycleStartDay: 'cycleStartDay',
  cooldownWeeks: 'cycleCooldownTime',
  cycleLockToActive: 'cycleLockToActive',
  cycleIssueAutoAssignStarted: 'cycleIssueAutoAssignStarted',
  cycleIssueAutoAssignCompleted: 'cycleIssueAutoAssignCompleted'
});

const PATCH_FIELDS = Object.freeze({ cycle: 'cycleId', addLabels: 'addedLabelIds', removeLabels: 'removedLabelIds' });

export function portError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

const unavailable = (what) => portError('capability_unavailable', `Linear 响应无法解析：${what}`);
const isDenied = ({ status, errors }) => status === 401 || status === 403 || (errors ?? []).some((e) => DENIAL.test(JSON.stringify(e)));

// --------------------------------------------------------------------------
// GraphQL 调用：transport 抛错与 HTTP 200 errors 统一成同一种响应体
// --------------------------------------------------------------------------

// 返回已排除拒绝访问的响应体；拒绝 = permission_denied，transport 带回的 GraphQL errors 并入响应体
async function call(request, query, variables) {
  const body = await request(query, variables).catch((err) => {
    if (err?.code === 'permission_denied' || isDenied(err ?? {})) throw portError('permission_denied', err.message);
    if (Array.isArray(err?.errors)) return { errors: err.errors };
    throw err;
  });
  if (isDenied(body ?? {})) throw portError('permission_denied', 'Linear 拒绝访问');
  return body ?? {};
}

function dataOf(body) {
  if (body.errors?.length) throw unavailable(body.errors.map((e) => e.message).join('; '));
  return body.data ?? {};
}

// 读：网络失败也是能力不可用（fail-close）；写不走这里，网络失败交核心判 uncertain
async function read(request, query, variables) {
  const body = await call(request, query, variables).catch((err) => {
    throw err?.code ? err : unavailable(`网络失败 ${err?.name ?? ''}`.trim());
  });
  return dataOf(body);
}

// --------------------------------------------------------------------------
// 形状转换：外部输入在这里校验一次
// --------------------------------------------------------------------------

function toConnection(conn, mapNode, what) {
  if (!Array.isArray(conn?.nodes) || typeof conn?.pageInfo?.hasNextPage !== 'boolean') throw unavailable(what);
  return { nodes: conn.nodes.map(mapNode), pageInfo: { hasNextPage: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor ?? null } };
}

function toIssue(node) {
  const shaped = typeof node?.id === 'string' && typeof node.state?.type === 'string'
    && Array.isArray(node.labels?.nodes) && Array.isArray(node.children?.nodes);
  if (!shaped) throw unavailable('Issue 节点');
  if (node.labels.pageInfo?.hasNextPage !== false) throw unavailable(`Issue ${node.id} 标签超过一页`);
  const parentId = node.parent?.id ?? null;
  return {
    id: node.id,
    teamId: node.team?.id ?? null,
    projectId: node.project?.id ?? null,
    statusType: node.state.type,
    labels: node.labels.nodes.map((l) => l.id),
    parentId,
    cycleId: node.cycle?.id ?? null,
    specRef: parentId !== null && node.children.nodes.length > 0 ? node.identifier : null
  };
}

function toCycle(node) {
  if (typeof node?.id !== 'string') throw unavailable('Cycle 节点');
  return { id: node.id, startsAt: node.startsAt, endsAt: node.endsAt };
}

function toConfiguration(team) {
  if (team === null || typeof team !== 'object') throw unavailable('Team');
  return Object.fromEntries(Object.entries(CONFIG_FIELDS).map(([key, field]) => [key, team[field] ?? null]));
}

function toInput(patch) {
  return Object.fromEntries(Object.entries(PATCH_FIELDS).filter(([key]) => key in patch).map(([key, field]) => [field, patch[key]]));
}

// --------------------------------------------------------------------------
// LinearPort
// --------------------------------------------------------------------------

export function createLinearAdapter({ request }) {
  const teamFilter = (scope) => ({ team: { id: { eq: scope.teamId } } });
  return {
    async readCycleConfiguration(teamId) {
      return toConfiguration((await read(request, QUERIES.team, { id: teamId })).team);
    },
    async listCycles(scope, cursor) {
      const data = await read(request, QUERIES.cycles, { after: cursor, filter: teamFilter(scope) });
      return toConnection(data.cycles, toCycle, 'cycles');
    },
    async listIssues(scope, cursor) {
      const filter = { ...teamFilter(scope), project: { id: { eq: scope.projectId } } };
      return toConnection((await read(request, QUERIES.issues, { after: cursor, filter })).issues, toIssue, 'issues');
    },
    async readIssue(issueId) {
      return toIssue((await read(request, QUERIES.issue, { id: issueId })).issue);
    },
    async readLabel(labelId) {
      const body = await call(request, QUERIES.label, { id: labelId });
      if (body.errors?.some((e) => /Entity not found/i.test(e.message))) return null;
      const label = dataOf(body).issueLabel;
      return label ? { id: label.id, teamId: label.team?.id ?? null } : null;
    },
    async patchIssue(issueId, patch) {
      const body = await call(request, QUERIES.update, { id: issueId, input: toInput(patch) });
      return body.errors?.length ? { errors: body.errors } : (body.data?.issueUpdate ?? body);
    }
  };
}

// --------------------------------------------------------------------------
// 钥匙串 transport：key 惰性读取一次，只进 Authorization 头
// --------------------------------------------------------------------------

export function createKeychainTransport({ user = userInfo().username, execFile = promisify(execFileCb), fetch = globalThis.fetch } = {}) {
  let key = null;
  const readKey = async () => {
    const args = ['find-generic-password', '-a', user, '-s', KEYCHAIN_SERVICE, '-w'];
    const { stdout } = await execFile('security', args).catch(() => ({ stdout: '' }));
    if (!stdout.trim()) throw portError('permission_denied', `钥匙串里没有 ${KEYCHAIN_SERVICE}`);
    return stdout.trim();
  };
  return async (query, variables) => {
    key ??= readKey();
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: await key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = await response.json().catch(() => null);
    if (response.ok) return body;
    throw Object.assign(new Error(`Linear HTTP ${response.status}`), { status: response.status, errors: body?.errors });
  };
}
