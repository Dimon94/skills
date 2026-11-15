// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/linear-mcp.js
//   INPUT: callTool(tool, args) → 官方 Linear MCP 工具的 JSON 结果；默认经 mcporter 调本机 magpie hub
//          （`mcporter call magpie.call_tool`，name = linear__<tool>），OAuth 留在 hub，不进本进程
//   OUTPUT: createMcporterCaller、createLinearMcpAdapter（LinearPort 实现）、createMcpEvidenceSource
//   POS: LinearPort 的默认 Adapter（CLI 缺省 `--transport mcp`）；只做工具形状与错误码转换，不做周期判断
//   TEST: node --test skills/delivery-cycle/tests/linear-mcp.test.js
//   PROTOCOL: 工具名、参数或返回形状变化时同步 repo://skills/delivery-cycle/SKILL.md「入口」
// L5
//   PARAM: Issue id = Linear identifier（如 DD-541）；parentId、specRef 同为 identifier；teamId／projectId／cycleId 为 UUID
//   PARAM: get_team 只返回基础身份，周期配置字段全为 null → 核心报 configuration_unverifiable 并点名字段；不补猜
//   PARAM: list_cycles 无分页参数，视为一次返回全部（推断）；list_issues 的描述会截断，Spec 身份逐项 get_issue 读全文
//   PARAM: 标签名经 list_issue_labels（本 Team）映射成 ID；同名多个 ID → 无法解析；Team 外标签名保留为 name:<名>
//   PARAM: patchIssue 总带 id（save_issue 无 id 会新建 Issue），只传 cycle 与 addLabels／removeLabels 增量
//   FAIL: 工具明确拒权（permission／forbidden／unauthorized／scope）= permission_denied；其余工具错误、mcporter
//         不可用、输出非 JSON = capability_unavailable；写入时执行失败或超时 = 结果未知（抛普通错误，交回读分类）
// ==========================================================================

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { isSpecDescription, portError, toConfiguration } from './linear-graphql.js';

const SERVER_TOOL = 'magpie.call_tool';
const TOOL_PREFIX = 'linear__';
const TIMEOUT_MS = 60_000;
const PAGE_SIZE = 50;
const LABEL_PAGE = 250;
const ISSUE_FIELDS = Object.freeze(['statusType', 'labels', 'parentId', 'cycleId', 'teamId', 'projectId', 'description']);
const DENIAL = /permission|forbidden|unauthori[sz]ed|not authorized|access denied|invalid scope/i;

const unavailable = (what) => portError('capability_unavailable', `Linear MCP 响应无法解析：${what}`);

// --------------------------------------------------------------------------
// 工具调用：mcporter 子进程 → 同一 magpie hub 上已授权的官方 Linear MCP
// --------------------------------------------------------------------------

// 工具返回的错误：只有明确拒权才是 permission_denied；toolRejected 表示平台已拒绝本次调用
export function toolError(tool, text) {
  const code = DENIAL.test(text) ? 'permission_denied' : 'capability_unavailable';
  return Object.assign(portError(code, `Linear MCP ${tool}：${text}`), { toolRejected: true });
}

function outcome(tool, stdout) {
  let body;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw unavailable(`${tool} 输出不是 JSON`);
  }
  if (body?.isError) throw toolError(tool, (body.content ?? []).map((c) => c?.text).filter(Boolean).join('; ') || 'isError');
  if (typeof body?.error === 'string') throw toolError(tool, body.error);
  return body;
}

export function createMcporterCaller({ execFile = promisify(execFileCb), bin = 'mcporter' } = {}) {
  return async (tool, args) => {
    const payload = JSON.stringify({ name: TOOL_PREFIX + tool, arguments: args });
    const argv = ['call', SERVER_TOOL, '--args', payload, '--output', 'json'];
    const { stdout } = await execFile(bin, argv, { timeout: TIMEOUT_MS, maxBuffer: 16 << 20 }).catch((err) => {
      if (typeof err?.stdout === 'string' && err.stdout.trim()) return { stdout: err.stdout };
      throw portError('capability_unavailable', `${bin} 调用失败：${err?.code ?? ''} ${err?.message ?? err}`.trim());
    });
    return outcome(tool, stdout);
  };
}

// --------------------------------------------------------------------------
// 形状转换
// --------------------------------------------------------------------------

function toCycle(node) {
  const shaped = typeof node?.id === 'string' && typeof node.startsAt === 'string' && typeof node.endsAt === 'string';
  if (!shaped) throw unavailable('Cycle');
  return { id: node.id, startsAt: node.startsAt, endsAt: node.endsAt };
}

// Team 外（如 workspace 级）标签只保留名字：核心只按排除标签 ID 比对，不需要它们的 ID
function labelIdOf(byName, name) {
  const ids = byName.get(name) ?? [];
  if (ids.length > 1) throw unavailable(`标签名 ${name} 对应多个标签`);
  return ids[0] ?? `name:${name}`;
}

function toIssue(node, byName) {
  const shaped = typeof node?.id === 'string' && typeof node.statusType === 'string'
    && Array.isArray(node.labels) && node.cycleId !== undefined;
  if (!shaped) throw unavailable('get_issue');
  return {
    id: node.id,
    teamId: node.teamId ?? null,
    projectId: node.projectId ?? null,
    statusType: node.statusType,
    labels: node.labels.map((name) => labelIdOf(byName, name)),
    parentId: node.parentId ?? null,
    cycleId: node.cycleId ?? null,
    specRef: isSpecDescription(node.description) ? node.id : null
  };
}

// 本 Team 标签全量分页读一次：name → [id]
async function readTeamLabels(callTool, teamId) {
  const byName = new Map();
  let cursor = null;
  do {
    const page = await callTool('list_issue_labels', { team: teamId, limit: LABEL_PAGE, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page?.labels)) throw unavailable('list_issue_labels');
    for (const { id, name } of page.labels) byName.set(name, [...(byName.get(name) ?? []), id]);
    const next = page.hasNextPage ? page.cursor : null;
    if (page.hasNextPage && (!next || next === cursor)) throw unavailable('list_issue_labels 分页游标未前进');
    cursor = next;
  } while (cursor);
  return byName;
}

// --------------------------------------------------------------------------
// LinearPort
// --------------------------------------------------------------------------

export function createLinearMcpAdapter({ callTool, teamId }) {
  let labels = null;
  const byName = () => (labels ??= readTeamLabels(callTool, teamId).catch((err) => { labels = null; throw err; }));
  const readIssue = async (id) => toIssue(await callTool('get_issue', { id, fields: ISSUE_FIELDS }), await byName());
  return {
    async readCycleConfiguration(team) {
      return toConfiguration(await callTool('get_team', { query: team }));
    },
    async listCycles(scope) {
      const cycles = await callTool('list_cycles', { teamId: scope.teamId });
      if (!Array.isArray(cycles)) throw unavailable('list_cycles');
      return { nodes: cycles.map(toCycle), pageInfo: { hasNextPage: false, endCursor: null } };
    },
    async listIssues(scope, cursor) {
      const args = { team: scope.teamId, project: scope.projectId, limit: PAGE_SIZE, fields: ['id'] };
      const page = await callTool('list_issues', cursor ? { ...args, cursor } : args);
      if (!Array.isArray(page?.issues) || typeof page.hasNextPage !== 'boolean') throw unavailable('list_issues');
      const nodes = [];
      for (const { id } of page.issues) nodes.push(await readIssue(id));
      return { nodes, pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.cursor ?? null } };
    },
    readIssue,
    async readLabel(labelId) {
      const found = [...(await byName()).values()].some((ids) => ids.includes(labelId));
      return found ? { id: labelId, teamId } : null;
    },
    patchIssue: (issueId, patch) => saveIssue(callTool, issueId, patch)
  };
}

// 平台拒绝 → {errors}；执行失败／超时 → 抛普通错误（结果未知）；成功只是声称，结论交回读
async function saveIssue(callTool, issueId, patch) {
  if (typeof issueId !== 'string' || !issueId) throw unavailable('patchIssue 缺 Issue id');
  const args = { id: issueId };
  if ('cycle' in patch) args.cycle = patch.cycle;
  if (patch.addLabels?.length) args.addLabels = patch.addLabels;
  if (patch.removeLabels?.length) args.removeLabels = patch.removeLabels;
  try {
    await callTool('save_issue', args);
    return { success: true };
  } catch (err) {
    if (err?.code === 'permission_denied') throw err;
    if (err?.toolRejected) return { errors: [{ message: err.message }] };
    throw new Error(`save_issue 结果未知：${err?.message ?? err}`);
  }
}

// --------------------------------------------------------------------------
// EvidenceSource（evidence.js 的来源接缝）：attachments 与评论归属
// --------------------------------------------------------------------------

async function findComment(callTool, issueId, commentId) {
  let cursor = null;
  do {
    const page = await callTool('list_comments', { issueId, limit: LABEL_PAGE, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page?.comments)) throw unavailable('list_comments');
    if (page.comments.some((c) => c?.id === commentId)) return true;
    const next = page.hasNextPage ? page.cursor : null;
    if (page.hasNextPage && (!next || next === cursor)) throw unavailable('list_comments 分页游标未前进');
    cursor = next;
  } while (cursor);
  return false;
}

export function createMcpEvidenceSource(callTool) {
  return {
    async pullUrls(issueId) {
      const issue = await callTool('get_issue', { id: issueId, fields: ['attachments'] });
      if (!Array.isArray(issue?.attachments)) throw unavailable('attachments');
      return issue.attachments.map((a) => a?.url);
    },
    // list_comments 不给评论 URL：按 Linear 评论锚点格式由 Issue url 拼出
    async comment(commentId, issueId) {
      if (!(await findComment(callTool, issueId, commentId))) return null;
      const { url } = await callTool('get_issue', { id: issueId, fields: ['url'] });
      if (typeof url !== 'string') throw unavailable('Issue url');
      return { url: `${url}#comment-${commentId.slice(0, 8)}`, issueId };
    }
  };
}
