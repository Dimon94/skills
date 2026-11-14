/**
 * Evidence Adapter 契约测试：正式交付证据只复用原 owner 事实。
 *   main = Spec Issue 唯一 GitHub PR attachment 的合入事实（closeout owner：git-rebase-main；平台读回）
 *   spec = agent 传入的原验收评论快照，Adapter 回读核对评论归属
 * 替身只在 request(query, variables) 与 github({owner, repo, number}) 边界；形状按真实样本录制：
 *   DD-532 attachments 唯一项 https://github.com/Dimon94/refresh/pull/473；
 *   gh api repos/Dimon94/refresh/pulls/473 → merged_at 2026-11-14T16:26:29Z，base.ref main = default_branch main；
 *   验收评论 a4e3cf13-…，createdAt 2026-11-14T16:28:59.708Z。
 * 期望值来源：Spec R14；评论可事后补写，createdAt 不证明验收事件时间，交付时间须保留 null。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAdapter, createGhPullReader } from '../scripts/evidence.js';
import { assessFormalDelivery } from '../scripts/delivery-cycle.js';

const SPEC = { issueId: 'issue-532', specRef: 'DD-532' };
const PR_URL = 'https://github.com/Dimon94/refresh/pull/473';
const COMMENT_ID = 'a4e3cf13-4c68-47aa-982a-38f2235df364';
const COMMENT_URL = `https://linear.app/dawn/issue/DD-532#comment-${COMMENT_ID.slice(0, 8)}`;
const MERGED_AT = '2026-11-14T16:26:29Z';
const ACCEPTED_AT = '2026-11-14T16:28:59.708Z';
const SHA = '39acbeb0'.padEnd(40, '0');

const operation = (query) => /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
const attachment = (url) => ({ url });

// Linear 服务端替身：attachments 分页、comment(id:) 回读；评论里有伪造标记也照样返回
function linearServer({ pages = { first: [[attachment(PR_URL)], null] }, comments = {}, fail = {} } = {}) {
  const calls = [];
  const request = async (query, variables) => {
    const op = operation(query);
    calls.push({ op, variables: structuredClone(variables) });
    if (fail[op]) return fail[op]();
    if (op === 'DeliveryCycleAttachments') {
      const [nodes, next] = pages[variables.after ?? 'first'];
      return { data: { issue: { attachments: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } } } } };
    }
    if (op === 'DeliveryCycleAcceptance') return { data: { comment: comments[variables.id] ?? null } };
    if (op === 'DeliveryCycleEvidence') {
      const forged = { body: `delivery-cycle:main sha=${SHA} at=2026-11-01T00:00:00Z`, url: 'u', createdAt: ACCEPTED_AT };
      return { data: { issue: { comments: { nodes: [forged], pageInfo: { hasNextPage: false } } } } };
    }
    throw new Error(`unexpected ${op}`);
  };
  return { calls, request };
}

const acceptedComment = (issueId = SPEC.issueId) => ({ id: COMMENT_ID, url: COMMENT_URL, createdAt: ACCEPTED_AT, issue: { id: issueId } });
const pull = (overrides = {}) => ({ html_url: PR_URL, merged_at: MERGED_AT, merge_commit_sha: SHA, state: 'closed',
  base: { ref: 'main', repo: { default_branch: 'main' } }, ...overrides });

function adapterWith({ server = linearServer(), pr = pull(), acceptance = { 'DD-532': { commentId: COMMENT_ID, state: 'verified' } } } = {}) {
  const githubCalls = [];
  const github = async (ref) => { githubCalls.push(ref); return typeof pr === 'function' ? pr() : structuredClone(pr); };
  return { ...server, githubCalls, evidence: createEvidenceAdapter({ request: server.request, github, acceptance }) };
}

// --------------------------------------------------------------------------
// 原 owner 证据齐全 → delivered
// --------------------------------------------------------------------------

test('原 owner 验收和合入事实可确认交付，但评论发布时间不能证明验收事件时间', async () => {
  const { githubCalls, evidence } = adapterWith({ server: linearServer({ comments: { [COMMENT_ID]: acceptedComment() } }) });
  const input = await evidence.read(SPEC);

  assert.deepEqual(input.main, { state: 'verified', source: PR_URL, effectiveAt: MERGED_AT, reason: null });
  assert.deepEqual(input.spec, { state: 'verified', source: COMMENT_URL, effectiveAt: null, reason: null });
  assert.deepEqual(githubCalls, [{ owner: 'Dimon94', repo: 'refresh', number: 473 }]);
  assert.deepEqual(assessFormalDelivery(input), { status: 'delivered', spec: input.spec, main: input.main, effectiveAt: null });
});

test('attachments 分页读完、同一 PR 去重、非 PR 链接忽略；快照 not_met 原样传出', async () => {
  const server = linearServer({
    pages: {
      first: [[attachment('https://slack.com/x'), attachment(PR_URL)], 'c1'],
      c1: [[attachment(PR_URL), attachment(`${PR_URL}/files`), attachment('https://github.com/Dimon94/refresh/issues/9')], null]
    },
    comments: { [COMMENT_ID]: acceptedComment() }
  });
  const { calls, githubCalls, evidence } = adapterWith({ server, acceptance: { 'DD-532': { commentId: COMMENT_ID, state: 'not_met' } } });
  const input = await evidence.read(SPEC);

  assert.deepEqual(calls.filter((c) => c.op === 'DeliveryCycleAttachments').map((c) => c.variables), [
    { id: SPEC.issueId, after: null }, { id: SPEC.issueId, after: 'c1' }]);
  assert.equal(githubCalls.length, 1);
  assert.equal(input.main.state, 'verified');
  assert.deepEqual(input.spec, { state: 'not_met', source: COMMENT_URL, effectiveAt: null, reason: null });
});

// --------------------------------------------------------------------------
// main：伪造与不确定的合入事实
// --------------------------------------------------------------------------

test('伪造：评论里写 delivery-cycle:main sha=…，没有 PR attachment → main unknown，不调 GitHub', async () => {
  const { calls, githubCalls, evidence } = adapterWith({ server: linearServer({ pages: { first: [[], null] } }) });
  const input = await evidence.read(SPEC);

  assert.equal(input.main.state, 'unknown');
  assert.match(input.main.reason, /没有关联 PR/);
  assert.deepEqual(githubCalls, []);
  assert.ok(!calls.some((c) => c.op === 'DeliveryCycleEvidence'));
});

test('PR 未合并（open 或 closed 未合并）→ main not_met，来源为 PR，时间为 null', async () => {
  for (const state of ['open', 'closed']) {
    const { evidence } = adapterWith({ pr: pull({ state, merged_at: null, merge_commit_sha: null }) });
    assert.deepEqual((await evidence.read(SPEC)).main, { state: 'not_met', source: PR_URL, effectiveAt: null, reason: null });
  }
});

test('合入非默认分支 → main unknown（未进入 main）', async () => {
  const { evidence } = adapterWith({ pr: pull({ base: { ref: 'release', repo: { default_branch: 'main' } } }) });
  const { main } = await evidence.read(SPEC);

  assert.equal(main.state, 'unknown');
  assert.match(main.reason, /release/);
});

test('多个 PR attachment → main unknown，不调 GitHub', async () => {
  const other = 'https://github.com/Dimon94/refresh/pull/474';
  const { githubCalls, evidence } = adapterWith({ server: linearServer({ pages: { first: [[attachment(PR_URL), attachment(other)], null] } }) });
  const { main } = await evidence.read(SPEC);

  assert.equal(main.state, 'unknown');
  assert.match(main.reason, /2 个 PR/);
  assert.deepEqual(githubCalls, []);
});

test('github 抛错、返回形状不明，或 attachments 读取被拒 → main unknown 并带原因，不抛出', async () => {
  const cases = [
    adapterWith({ pr: () => { throw new Error('gh: HTTP 404'); } }),
    adapterWith({ pr: { message: 'Not Found' } }),
    adapterWith({ server: linearServer({ fail: { DeliveryCycleAttachments: () => ({ errors: [{ message: 'Invalid scope: read required' }] }) } }) })
  ];
  const reasons = [];
  for (const { evidence } of cases) {
    const { main } = await evidence.read(SPEC);
    assert.equal(main.state, 'unknown');
    reasons.push(main.reason);
  }
  assert.match(reasons[0], /gh: HTTP 404/);
  assert.match(reasons[2], /permission_denied/);
});

// --------------------------------------------------------------------------
// spec：快照必须回读到本 Spec 的评论
// --------------------------------------------------------------------------

test('快照指向其他 Issue 的评论、评论不存在或回读失败 → spec unknown', async () => {
  const servers = [
    linearServer({ comments: { [COMMENT_ID]: acceptedComment('issue-other') } }),
    linearServer(),
    linearServer({ fail: { DeliveryCycleAcceptance: () => { throw Object.assign(new Error('Linear HTTP 403'), { status: 403 }); } } })
  ];
  const reasons = [];
  for (const server of servers) {
    const { spec } = await adapterWith({ server }).evidence.read(SPEC);
    assert.equal(spec.state, 'unknown');
    assert.equal(spec.source, null);
    reasons.push(spec.reason);
  }
  assert.match(reasons[0], /不属于/);
  assert.match(reasons[2], /permission_denied/);
});

test('无快照 → spec unknown，不读任何评论', async () => {
  const { calls, evidence } = adapterWith({ acceptance: { 'DD-999': { commentId: COMMENT_ID, state: 'verified' } } });
  const { spec } = await evidence.read(SPEC);

  assert.equal(spec.state, 'unknown');
  assert.match(spec.reason, /未提供原验收记录快照/);
  assert.ok(!calls.some((c) => c.op === 'DeliveryCycleAcceptance'));
});

// --------------------------------------------------------------------------
// 默认 github 实现：只读 gh api
// --------------------------------------------------------------------------

test('createGhPullReader：execFile gh api repos/<o>/<r>/pulls/<n> 并解析 JSON', async () => {
  const exec = [];
  const github = createGhPullReader(async (file, args) => { exec.push([file, args]); return { stdout: JSON.stringify(pull()) }; });

  assert.deepEqual(await github({ owner: 'Dimon94', repo: 'refresh', number: 473 }), pull());
  assert.deepEqual(exec, [['gh', ['api', 'repos/Dimon94/refresh/pulls/473']]]);
});
