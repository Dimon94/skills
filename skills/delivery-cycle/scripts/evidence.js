// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/evidence.js
//   INPUT: 父 Spec Issue 的 Linear 评论（request(query, variables)）；本地仓库 git 祖先校验（git(args)）
//   OUTPUT: createEvidenceAdapter（EvidencePort 实现）、createGitAncestry
//   POS: 只把外部证据转成 EvidencePort 形状；正式交付判断归 delivery-cycle.js 的 assessFormalDelivery
//   TEST: node --test skills/delivery-cycle/tests/evidence.test.js
//   PROTOCOL: 标记格式变化时同步 repo://skills/delivery-cycle/SKILL.md「正式交付」节
// L5
//   PARAM（新增约定，待根协调者确认）：证据只认父 Spec Issue 上整条评论为一行的严格标记：
//          delivery-cycle:spec state=verified|not_met at=<ISO 8601 带时区，可空>
//          delivery-cycle:main sha=<40 位小写 hex> at=<ISO 8601 带时区，可空>
//          同一条件多条标记时取 createdAt 最新者；Issue 状态、Done、正文声称都不算证据
//   PARAM: spec 来源 = 评论 URL；main 须 `git merge-base --is-ancestor <sha> main` 为真才 verified，
//          来源 = git:main@<sha>；effectiveAt 只取标记 at，缺失为 null，不拿提交日期补
//   FAIL: 无标记、sha 不在 main、git 校验失败 → 该条件 unknown 并给 reason
//   FAIL: 评论读取失败 → 抛出（核心转 evidence_unavailable）；拒绝访问 = permission_denied，其余 = capability_unavailable
// ==========================================================================

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { portError } from './linear-graphql.js';

const COMMENTS = `query DeliveryCycleEvidence($id: String!, $after: String) {
  issue(id: $id) { comments(after: $after, first: 50) {
    nodes { body url createdAt } pageInfo { hasNextPage endCursor } } } }`;

const MARKERS = Object.freeze({
  spec: /^delivery-cycle:spec state=(verified|not_met) at=(\S*)$/,
  main: /^delivery-cycle:main sha=([0-9a-f]{40}) at=(\S*)$/
});

const unknown = (reason) => ({ state: 'unknown', source: null, effectiveAt: null, reason });

// --------------------------------------------------------------------------
// 评论分页：读取失败抛出；分页异常 fail-close
// --------------------------------------------------------------------------

async function readComments(request, issueId) {
  const comments = [];
  let after = null;
  do {
    const body = await request(COMMENTS, { id: issueId, after }).catch((err) => ({ errors: [err] }));
    if (body?.errors?.length) throw failure(body.errors);
    const conn = body?.data?.issue?.comments;
    if (!Array.isArray(conn?.nodes)) throw portError('capability_unavailable', '评论响应无法解析');
    comments.push(...conn.nodes);
    if (conn.pageInfo?.hasNextPage && (!conn.pageInfo.endCursor || conn.pageInfo.endCursor === after)) {
      throw portError('capability_unavailable', '评论分页游标未前进');
    }
    after = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after !== null);
  return comments;
}

function failure(errors) {
  const text = JSON.stringify(errors.map((e) => ({ message: e?.message, status: e?.status, extensions: e?.extensions })));
  const denied = /AUTHENTICATION_ERROR|FORBIDDEN|Invalid scope|"status":40[13]/i.test(text);
  return portError(denied ? 'permission_denied' : 'capability_unavailable', '读取证据评论失败');
}

// 每个条件取 createdAt 最新的严格标记
function latestMarker(comments, kind) {
  const hits = comments
    .map((c) => ({ c, m: MARKERS[kind].exec(String(c.body ?? '').trim()) }))
    .filter(({ m }) => m !== null)
    .sort((a, b) => Date.parse(b.c.createdAt) - Date.parse(a.c.createdAt));
  return hits[0] ?? null;
}

// --------------------------------------------------------------------------
// EvidencePort
// --------------------------------------------------------------------------

function specEvidence(hit) {
  if (!hit) return unknown('父 Spec Issue 上没有 delivery-cycle:spec 标记');
  return { state: hit.m[1], source: hit.c.url, effectiveAt: hit.m[2] || null, reason: null };
}

async function mainEvidence(hit, git) {
  if (!hit) return unknown('父 Spec Issue 上没有 delivery-cycle:main 标记');
  const sha = hit.m[1];
  const ancestor = await git(['merge-base', '--is-ancestor', sha, 'main']).catch(() => null);
  if (ancestor === null) return unknown(`git 无法校验 ${sha}`);
  if (!ancestor) return unknown(`${sha} 不在 main 上`);
  return { state: 'verified', source: `git:main@${sha}`, effectiveAt: hit.m[2] || null, reason: null };
}

export function createEvidenceAdapter({ request, git }) {
  return {
    async read({ issueId }) {
      const comments = await readComments(request, issueId);
      return {
        spec: specEvidence(latestMarker(comments, 'spec')),
        main: await mainEvidence(latestMarker(comments, 'main'), git)
      };
    }
  };
}

// 退出码 0 = 是祖先，1 = 不是；其余（无此 sha、不是仓库）抛出
export function createGitAncestry(repo, execFile = promisify(execFileCb)) {
  return (args) => execFile('git', ['-C', repo, ...args]).then(() => true, (err) => {
    if (err?.code === 1) return false;
    throw err;
  });
}
