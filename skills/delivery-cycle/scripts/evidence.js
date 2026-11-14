// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/evidence.js
//   INPUT: Spec Issue 的 Linear attachments 与指定评论（request(query, variables)）；
//          GitHub PR 合入事实（github({owner, repo, number})，默认 gh api 只读）；
//          agent 传入的原验收评论快照 acceptance = {[specRef]: {commentId, state}}
//   OUTPUT: createEvidenceAdapter（EvidencePort 实现）、createGhPullReader
//   POS: 只把原 owner 事实转成 EvidencePort 形状；正式交付判断归 delivery-cycle.js 的 assessFormalDelivery
//   TEST: node --test skills/delivery-cycle/tests/evidence.test.js
//   PROTOCOL: 证据来源变化时同步 repo://skills/delivery-cycle/SKILL.md「正式交付」节
// L5
//   PARAM: main 来源 = closeout 的 PR 合入事实（owner：repo://skills/git-rebase-main/references/closeout.md）。
//          Spec Issue attachments 中唯一匹配 ^https://github.com/<owner>/<repo>/pull/<n>$ 的 URL（去重）；
//          merged_at 非空且 base.ref = base.repo.default_branch → verified，source = html_url，effectiveAt = merged_at；
//          未合并 → not_met（effectiveAt null）；0 个或多个 PR、合入非默认分支、形状不明 → unknown
//   PARAM: spec 来源 = 原验收评论快照（owner：Spec 验收／closeout 记录）。自由文本由 agent 判断，CLI 只回读
//          comment(id:)：issue.id 等于该 Spec issueId → state 取快照值，source = 评论 url，effectiveAt = null（评论发布时间不证明验收实际发生时间）；
//          无快照、评论读不到或不属于该 Spec → unknown。快照只是引用，不存本地状态
//   PARAM: 不读任何评论正文里的 sha／at，不用提交日期；Issue 状态、Done、正文声称都不算证据
//   FAIL: Linear 或 GitHub 读取失败 → 该条件 unknown，reason 带 code 与原因（含 permission_denied）；read 不抛出
// ==========================================================================

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { portError, readLinear } from './linear-graphql.js';

const QUERIES = Object.freeze({
  attachments: `query DeliveryCycleAttachments($id: String!, $after: String) {
    issue(id: $id) { attachments(after: $after, first: 50) { nodes { url } pageInfo { hasNextPage endCursor } } } }`,
  acceptance: `query DeliveryCycleAcceptance($id: String!) { comment(id: $id) { id url createdAt issue { id } } }`
});

const PULL_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/;
const GH_TIMEOUT_MS = 30_000;

const unknown = (reason) => ({ state: 'unknown', source: null, effectiveAt: null, reason });
const fact = (state, source, effectiveAt) => ({ state, source, effectiveAt, reason: null });

// 读取失败不抛出：该条件降为 unknown，原因可追溯
const settle = (work, what) => work.catch((err) => unknown(`${what}失败：${[err?.code, err?.message ?? err].filter(Boolean).join(' ')}`));

// --------------------------------------------------------------------------
// main：Spec Issue 唯一 PR 的合入事实
// --------------------------------------------------------------------------

function pullRef(attachment) {
  const m = PULL_URL.exec(String(attachment?.url ?? ''));
  return m && { owner: m[1], repo: m[2], number: Number(m[3]) };
}

function nextCursor(pageInfo, after) {
  if (!pageInfo?.hasNextPage) return null;
  if (!pageInfo.endCursor || pageInfo.endCursor === after) throw portError('capability_unavailable', 'attachments 分页游标未前进');
  return pageInfo.endCursor;
}

async function readPullRefs(request, issueId) {
  const refs = new Map();
  let after = null;
  do {
    const conn = (await readLinear(request, QUERIES.attachments, { id: issueId, after })).issue?.attachments;
    if (!Array.isArray(conn?.nodes)) throw portError('capability_unavailable', 'attachments 响应无法解析');
    for (const ref of conn.nodes.map(pullRef).filter(Boolean)) refs.set(`${ref.owner}/${ref.repo}#${ref.number}`, ref);
    after = nextCursor(conn.pageInfo, after);
  } while (after !== null);
  return [...refs.values()];
}

function mergeFact(pr) {
  const base = pr?.base;
  const shaped = typeof pr?.html_url === 'string' && (pr.merged_at === null || typeof pr.merged_at === 'string')
    && typeof base?.ref === 'string' && typeof base.repo?.default_branch === 'string';
  if (!shaped) return unknown('PR 响应形状不明');
  if (pr.merged_at === null) return fact('not_met', pr.html_url, null);
  if (base.ref !== base.repo.default_branch) return unknown(`PR 合入 ${base.ref}，不是默认分支 ${base.repo.default_branch}`);
  return fact('verified', pr.html_url, pr.merged_at);
}

async function mainEvidence(request, github, issueId) {
  const refs = await readPullRefs(request, issueId);
  if (refs.length === 0) return unknown('Spec Issue 没有关联 PR');
  if (refs.length > 1) return unknown(`Spec Issue 关联了 ${refs.length} 个 PR，无法确定唯一合入`);
  return mergeFact(await github(refs[0]));
}

// --------------------------------------------------------------------------
// spec：回读快照评论，核对归属
// --------------------------------------------------------------------------

async function specEvidence(request, snapshot, issueId) {
  if (!snapshot) return unknown('未提供原验收记录快照');
  const { comment } = await readLinear(request, QUERIES.acceptance, { id: snapshot.commentId });
  if (!comment) return unknown(`读不到评论 ${snapshot.commentId}`);
  if (comment.issue?.id !== issueId) return unknown(`评论 ${snapshot.commentId} 不属于该 Spec Issue`);
  return fact(snapshot.state, comment.url, null);
}

// --------------------------------------------------------------------------
// EvidencePort
// --------------------------------------------------------------------------

export function createEvidenceAdapter({ request, github = createGhPullReader(), acceptance = {} }) {
  return {
    async read({ issueId, specRef }) {
      const snapshot = Object.hasOwn(acceptance, specRef ?? '') ? acceptance[specRef] : null;
      const [spec, main] = await Promise.all([
        settle(specEvidence(request, snapshot, issueId), '读取原验收评论'),
        settle(mainEvidence(request, github, issueId), '读取 PR 合入事实')
      ]);
      return { spec, main };
    }
  };
}

// 默认 github：只读 gh api；参数经 execFile 传递，不经 shell
export function createGhPullReader(execFile = promisify(execFileCb)) {
  return async ({ owner, repo, number }) => {
    const { stdout } = await execFile('gh', ['api', `repos/${owner}/${repo}/pulls/${number}`], { timeout: GH_TIMEOUT_MS });
    return JSON.parse(stdout);
  };
}
