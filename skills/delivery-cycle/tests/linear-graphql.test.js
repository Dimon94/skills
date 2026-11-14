/**
 * 真实 Linear GraphQL Adapter 与钥匙串 transport 的契约测试。
 * 替身只在 request(query, variables) 与 execFile／fetch 边界；响应形状按 Linear schema 录制。
 * 期望值来源：brief 第 1、2、6 条；Spec R2、§3；schema（Team.cycleDuration 周、cycleStartDay 0=周日）。
 * 不调用真实网络，不读真实钥匙串。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeychainTransport, createLinearAdapter } from '../scripts/linear-graphql.js';
import { maintainCurrentWeek } from '../scripts/delivery-cycle.js';
import { FakeEvidence, SCOPE, TUESDAY, WEEK } from './fake-adapters.js';

const operation = (query) => /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];

function recorder(respond) {
  const calls = [];
  const request = async (query, variables) => {
    calls.push({ op: operation(query), query, variables: structuredClone(variables) });
    return respond(operation(query), variables);
  };
  return { calls, request };
}

// Linear Issue 节点的录制形状（查询不再请求 children；层级只由 parent 表达）
function node({ id, state = 'started', cycle = null, parent = null, labels = [],
  team = 'team-1', project = 'project-1', moreLabels = false, description = null, title = `Issue ${id}` }) {
  return {
    id, identifier: `DD-${id}`, title, description, team: { id: team }, project: project && { id: project },
    state: { type: state }, cycle: cycle && { id: cycle }, parent: parent && { id: parent },
    labels: { nodes: labels.map((l) => ({ id: l })), pageInfo: { hasNextPage: moreLabels } }
  };
}

// 期望值来源：repo://skills/to-spec/SKILL.md 与上游 mattpocock to-spec 共有的六个二级标题；
// ticket 模板来自 to-tickets（## Parent／## What to build／## Acceptance criteria）；Epic 样本 DD-539 以 `# Epic：` 开头
const SPEC_HEADINGS = ['Problem Statement', 'Solution', 'User Stories', 'Implementation Decisions', 'Testing Decisions', 'Out of Scope'];
const specBody = (headings = SPEC_HEADINGS, suffix = '') => headings.map((h) => `## ${h}${suffix}\n\n正文\n`).join('\n');
const SPEC_BODY = specBody();
const TICKET_BODY = '## Parent\n\nDD-S\n\n## What to build\n\n正文\n\n## Acceptance criteria\n\n- [ ] 结果';
const EPIC_BODY = '# Epic：周期维护\n\n## 目标\n\n正文';

const connection = (nodes, endCursor = null) => ({ nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } });
const DENIED = [{ message: 'Invalid scope: read required' }];

// --------------------------------------------------------------------------
// 读：过滤、分页、映射
// --------------------------------------------------------------------------

test('listIssues 同时按团队与项目过滤，游标原样传 after，请求 description；Spec 身份来自 to-spec 模板', async () => {
  const { calls, request } = recorder(() => ({
    data: { issues: connection([
      node({ id: 'E', state: 'unstarted', description: EPIC_BODY }),
      node({ id: 'S', parent: 'E', cycle: 'cycle-0', labels: ['l1'], description: SPEC_BODY }),
      node({ id: 'T', parent: 'S', description: TICKET_BODY })
    ], 'c2') }
  }));
  const page = await createLinearAdapter({ request }).listIssues(SCOPE, 'c1');

  assert.deepEqual(calls[0].variables, {
    after: 'c1', filter: { team: { id: { eq: 'team-1' } }, project: { id: { eq: 'project-1' } } }
  });
  assert.match(calls[0].query, /\bdescription\b/);
  assert.deepEqual(page, {
    nodes: [
      { id: 'E', teamId: 'team-1', projectId: 'project-1', statusType: 'unstarted', labels: [], parentId: null, cycleId: null, specRef: null },
      { id: 'S', teamId: 'team-1', projectId: 'project-1', statusType: 'started', labels: ['l1'], parentId: 'E', cycleId: 'cycle-0', specRef: 'DD-S' },
      { id: 'T', teamId: 'team-1', projectId: 'project-1', statusType: 'started', labels: [], parentId: 'S', cycleId: null, specRef: null }
    ],
    pageInfo: { hasNextPage: true, endCursor: 'c2' }
  });
});

const specRefOf = async (fields) => (await createLinearAdapter({ request: async () => ({ data: { issue: node(fields) } }) }).readIssue('A')).specRef;

test('无父项、无子项的独立 Spec（零 ticket MMF／无 Epic）按模板识别；标题后允许空白', async () => {
  assert.equal(await specRefOf({ id: 'X', description: SPEC_BODY }), 'DD-X');
  assert.equal(await specRefOf({ id: 'Y', description: specBody(SPEC_HEADINGS, '  ').replaceAll('\n', '\r\n') }), 'DD-Y');
});

test('有父项、自己也有子项但是 ticket 模板的深层 Issue 不是 Spec', async () => {
  assert.equal(await specRefOf({ id: 'T', parent: 'S', description: TICKET_BODY }), null);
});

test('Epic、空描述、缺描述、只含部分标题、标题前缀不在行首、标题写“Spec：”但无模板 → 不是 Spec（与层级无关）', async () => {
  const bodies = [EPIC_BODY, '', null, specBody(SPEC_HEADINGS.slice(1)),
    specBody(SPEC_HEADINGS).replace('## Out of Scope', '> ## Out of Scope'),
    specBody(SPEC_HEADINGS).replace('## Solution', '## Solutions')];
  for (const description of bodies) {
    assert.equal(await specRefOf({ id: 'A', parent: 'E', description }), null, String(description).slice(0, 30));
  }
  assert.equal(await specRefOf({ id: 'B', parent: 'E', title: 'Spec：周期维护', description: TICKET_BODY }), null);
});

test('listCycles 按团队过滤并映射 startsAt／endsAt', async () => {
  const { calls, request } = recorder(() => ({
    data: { cycles: connection([{ id: 'cycle-1', number: 46, startsAt: WEEK.start, endsAt: WEEK.end }]) }
  }));
  const page = await createLinearAdapter({ request }).listCycles(SCOPE, null);

  assert.deepEqual(calls[0].variables, { after: null, filter: { team: { id: { eq: 'team-1' } } } });
  assert.deepEqual(page.nodes, [{ id: 'cycle-1', startsAt: WEEK.start, endsAt: WEEK.end }]);
});

test('readCycleConfiguration 映射 schema 字段；缺字段为 null，不猜', async () => {
  const team = { cyclesEnabled: true, timezone: 'Asia/Shanghai', cycleDuration: 1, cycleStartDay: 1,
    cycleCooldownTime: 0, cycleLockToActive: false, cycleIssueAutoAssignStarted: true, cycleIssueAutoAssignCompleted: false };
  const full = await createLinearAdapter({ request: async () => ({ data: { team } }) }).readCycleConfiguration('team-1');
  const { cycleDuration, cycleCooldownTime, ...partial } = team;
  const missing = await createLinearAdapter({ request: async () => ({ data: { team: partial } }) }).readCycleConfiguration('team-1');

  assert.deepEqual(full, { cyclesEnabled: true, timezone: 'Asia/Shanghai', cycleDurationWeeks: 1, cycleStartDay: 1,
    cooldownWeeks: 0, cycleLockToActive: false, cycleIssueAutoAssignStarted: true, cycleIssueAutoAssignCompleted: false });
  assert.equal(missing.cycleDurationWeeks, null);
  assert.equal(missing.cooldownWeeks, null);
});

test('readLabel 返回 {id, teamId}；Entity not found 视为标签缺失（null）', async () => {
  const found = createLinearAdapter({ request: async () => ({ data: { issueLabel: { id: 'L', team: { id: 'team-1' } } } }) });
  const gone = createLinearAdapter({ request: async () => ({ data: null, errors: [{ message: 'Entity not found: IssueLabel' }] }) });

  assert.deepEqual(await found.readLabel('L'), { id: 'L', teamId: 'team-1' });
  assert.equal(await gone.readLabel('L'), null);
});

test('标签超过一页或节点形状不明时 fail-close 为 capability_unavailable，不截断', async () => {
  const many = createLinearAdapter({ request: async () => ({ data: { issue: node({ id: 'A', moreLabels: true }) } }) });
  const odd = createLinearAdapter({ request: async () => ({ data: { issues: { edges: [] } } }) });

  await assert.rejects(many.readIssue('A'), { code: 'capability_unavailable' });
  await assert.rejects(odd.listIssues(SCOPE, null), { code: 'capability_unavailable' });
});

// --------------------------------------------------------------------------
// 错误映射
// --------------------------------------------------------------------------

test('HTTP 200 的 GraphQL errors：读抛 capability_unavailable，写返回 {errors} 交核心判 rejected', async () => {
  const errors = [{ message: 'Argument Validation Error', extensions: { code: 'INVALID_INPUT' } }];
  const linear = createLinearAdapter({ request: async () => ({ data: null, errors }) });

  await assert.rejects(linear.readIssue('A'), { code: 'capability_unavailable' });
  await assert.rejects(linear.listIssues(SCOPE, null), { code: 'capability_unavailable' });
  assert.deepEqual(await linear.patchIssue('A', { cycle: 'cycle-1' }), { errors });
});

test('Invalid scope／AUTHENTICATION_ERROR／HTTP 401、403 一律 permission_denied，读写都一样', async () => {
  const bodies = [
    async () => ({ data: null, errors: DENIED }),
    async () => ({ errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] }),
    async () => { throw Object.assign(new Error('Linear HTTP 401'), { status: 401 }); },
    async () => { throw Object.assign(new Error('Linear HTTP 403'), { status: 403 }); }
  ];
  for (const request of bodies) {
    const linear = createLinearAdapter({ request });
    await assert.rejects(linear.readCycleConfiguration('team-1'), { code: 'permission_denied' });
    await assert.rejects(linear.patchIssue('A', { cycle: 'cycle-1' }), { code: 'permission_denied' });
  }
});

// --------------------------------------------------------------------------
// 写：只发增量字段
// --------------------------------------------------------------------------

test('patchIssue 只发出现的增量字段，绝不发 labelIds；cycle: null 原样清空', async () => {
  const { calls, request } = recorder(() => ({ data: { issueUpdate: { success: true } } }));
  const linear = createLinearAdapter({ request });
  const claims = [
    await linear.patchIssue('A', { cycle: 'cycle-1' }),
    await linear.patchIssue('A', { addLabels: ['L'] }),
    await linear.patchIssue('A', { removeLabels: ['L'] }),
    await linear.patchIssue('A', { cycle: null })
  ];

  assert.deepEqual(calls.map((c) => c.variables), [
    { id: 'A', input: { cycleId: 'cycle-1' } },
    { id: 'A', input: { addedLabelIds: ['L'] } },
    { id: 'A', input: { removedLabelIds: ['L'] } },
    { id: 'A', input: { cycleId: null } }
  ]);
  assert.ok(calls.every((c) => !c.query.includes('labelIds:')));
  assert.deepEqual(claims, Array(4).fill({ success: true }));
});

// --------------------------------------------------------------------------
// 经核心公开入口：两页拼接、Epic 不进 Cycle、写超时归 write_unknown
// --------------------------------------------------------------------------

const R2_ISSUES = () => [
  node({ id: 'E', state: 'unstarted', description: EPIC_BODY }),
  node({ id: 'P', parent: 'E', state: 'unstarted', description: SPEC_BODY }),
  node({ id: 'T', parent: 'P', description: TICKET_BODY })
];

// 两页：第一页除最后一项外全部，第二页只放最后一项
function linearServer({ onUpdate, issues: list = R2_ISSUES() } = {}) {
  const issues = new Map(list.map((n) => [n.id, n]));
  const ids = [...issues.keys()];
  const pages = { null: [ids.slice(0, -1), 'c1'], c1: [ids.slice(-1), null] };
  const team = { cyclesEnabled: true, timezone: 'Asia/Shanghai', cycleDuration: 1, cycleStartDay: 1, cycleCooldownTime: 0 };
  const respond = (op, v) => {
    if (op === 'DeliveryCycleTeam') return { data: { team } };
    if (op === 'DeliveryCycleCycles') return { data: { cycles: connection([{ id: 'cycle-1', startsAt: WEEK.start, endsAt: WEEK.end }]) } };
    if (op === 'DeliveryCycleLabel') return { data: { issueLabel: { id: SCOPE.exclusionLabelId, team: { id: 'team-1' } } } };
    if (op === 'DeliveryCycleIssue') return { data: { issue: issues.get(v.id) } };
    if (op === 'DeliveryCycleIssues') {
      const [page, next] = pages[v.after];
      return { data: { issues: connection(page.map((id) => issues.get(id)), next) } };
    }
    if (onUpdate) return onUpdate(v);
    issues.get(v.id).cycle = { id: v.input.cycleId };
    return { data: { issueUpdate: { success: true } } };
  };
  return recorder(respond);
}

const runWith = (request) => maintainCurrentWeek({ scope: SCOPE, exclude: [], restore: [] },
  { linear: createLinearAdapter({ request }), evidence: new FakeEvidence(), now: TUESDAY });
const updatesOf = (calls) => calls.filter((c) => c.op === 'DeliveryCycleUpdate').map((c) => c.variables)
  .sort((a, b) => a.id.localeCompare(b.id));

test('R2：第二页的进行中 ticket 拉入父 Spec；Epic 不进 Cycle；只写 cycleId', async () => {
  const { calls, request } = linearServer();
  const result = await runWith(request);

  assert.equal(result.status, 'synchronized');
  assert.deepEqual(calls.filter((c) => c.op === 'DeliveryCycleIssues').slice(0, 2).map((c) => c.variables.after), [null, 'c1']);
  assert.deepEqual(updatesOf(calls), [{ id: 'P', input: { cycleId: 'cycle-1' } }, { id: 'T', input: { cycleId: 'cycle-1' } }]);
});

test('经核心入口：进行中的无 Epic 独立 Spec（零 ticket）纳入本周', async () => {
  const { calls, request } = linearServer({ issues: [
    node({ id: 'O', state: 'unstarted', description: TICKET_BODY }),
    node({ id: 'X', description: SPEC_BODY })
  ] });
  const result = await runWith(request);

  assert.equal(result.status, 'synchronized');
  assert.deepEqual(updatesOf(calls), [{ id: 'X', input: { cycleId: 'cycle-1' } }]);
});

test('经核心入口：ticket 模板的深层 Issue 有子项也不当 Spec，其进行中的子项不当 ticket 纳入', async () => {
  const { calls, request } = linearServer({ issues: [
    node({ id: 'S', parent: 'E', state: 'unstarted', description: SPEC_BODY }),
    node({ id: 'T', parent: 'S', state: 'unstarted', description: TICKET_BODY }),
    node({ id: 'D', parent: 'T', description: TICKET_BODY })
  ] });
  const result = await runWith(request);

  assert.deepEqual(updatesOf(calls), []);
  assert.deepEqual(result.problems.filter((p) => p.issueId === 'D').map((p) => p.code), ['identity_unverifiable']);
});

test('写入网络超时不是确定失败：该项归 write_unknown', async () => {
  const timeout = () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  const result = await runWith(linearServer({ onUpdate: timeout }).request);

  assert.ok(result.problems.some((p) => p.code === 'write_unknown'));
  assert.ok(!result.problems.some((p) => p.code === 'permission_denied' || p.code === 'capability_unavailable'));
});

// --------------------------------------------------------------------------
// 钥匙串 transport
// --------------------------------------------------------------------------

function transportWith(response) {
  const exec = [];
  const fetched = [];
  const transport = createKeychainTransport({
    user: 'dimon',
    execFile: async (file, args) => { exec.push([file, args]); return { stdout: 'lin_api_SECRET\n' }; },
    fetch: async (url, init) => { fetched.push({ url, init }); return response; }
  });
  return { exec, fetched, transport };
}

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('transport 用 execFile 读钥匙串，原样放进 Authorization（无 Bearer），30s 超时，钥匙只读一次', async () => {
  const { exec, fetched, transport } = transportWith(jsonResponse(200, { data: { ok: 1 } }));
  const first = await transport('query A { a }', { x: 1 });
  await transport('query B { b }', {});

  assert.deepEqual(first, { data: { ok: 1 } });
  assert.deepEqual(exec, [['security', ['find-generic-password', '-a', 'dimon', '-s', 'refresh-linear-api-key', '-w']]]);
  assert.equal(fetched[0].url, 'https://api.linear.app/graphql');
  assert.equal(fetched[0].init.method, 'POST');
  assert.deepEqual(fetched[0].init.headers, { Authorization: 'lin_api_SECRET', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(fetched[0].init.body), { query: 'query A { a }', variables: { x: 1 } });
  assert.ok(fetched[0].init.signal instanceof AbortSignal);
});

test('transport 非 2xx 抛出带 status 与 GraphQL errors 的错误，错误文本不含钥匙', async () => {
  const { transport } = transportWith(jsonResponse(400, { errors: DENIED }));
  const err = await transport('query A { a }', {}).catch((e) => e);

  assert.equal(err.status, 400);
  assert.deepEqual(err.errors, DENIED);
  assert.ok(!JSON.stringify({ message: err.message, stack: err.stack, ...err }).includes('SECRET'));
  await assert.rejects(createLinearAdapter({ request: transport }).listIssues(SCOPE, null), { code: 'permission_denied' });
});

// 真实录制形状（2026-11-14 Dawn 只读实测）：HTTP 400 + FORBIDDEN errors；原因必须原样带到 problem.message
test('真实 HTTP 400 Invalid scope 响应经 transport+Adapter 报 permission_denied，消息保留平台原因', async () => {
  const body = { errors: [{ message: 'Invalid scope: `read` required', extensions: { code: 'FORBIDDEN' } }] };
  const { transport } = transportWith(jsonResponse(400, body));
  const linear = createLinearAdapter({ request: transport });
  await assert.rejects(linear.readCycleConfiguration('team-1'), (err) => {
    assert.equal(err.code, 'permission_denied');
    assert.match(err.message, /Invalid scope: `read` required/);
    assert.doesNotMatch(err.message, /lin_api_SECRET/);
    return true;
  });
});
