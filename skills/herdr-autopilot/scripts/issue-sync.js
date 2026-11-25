'use strict';

// ============================================================================
// L3-L6 Contract: herdr-autopilot deterministic tracker issue state sync
// - COORD: skills/herdr-autopilot/scripts/issue-sync.js
// - INPUT: issue key/URL, target ('started' | 'review' | 'done'), tracker adapter.
// - OUTPUT: verified readback state { issue, tracker, previous_state, state,
//   status_type, changed, parents_synced }.
// - INVARIANT: read-before-write (idempotent), mandatory readback after every
//   write, fail-close on terminal mismatch or readback failure. On 'started',
//   unstarted Linear parent chain (Spec/Epic, max depth 4) is also promoted to
//   In Progress; on 'done', only the direct issue is closed (parents read-only).
// - TEST: node --test skills/herdr-autopilot/tests/autopilot.test.js
// ============================================================================

const { execFileSync } = require('node:child_process');

const VALID_TARGETS = new Set(['started', 'review', 'done']);
const UNSTARTED_TYPES = new Set(['triage', 'backlog', 'unstarted']);
const TERMINAL_TYPES = new Set(['completed', 'canceled', 'duplicate']);
const LINEAR_FIELDS = ['id', 'status', 'statusType', 'teamId', 'parentId'];
const MAX_PARENT_DEPTH = 4;
const DEFAULT_TIMEOUT_MS = 30000;

function parseIssueRef(raw) {
  const value = String(raw || '').trim();
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(value)) {
    return { tracker: 'linear', id: value };
  }
  const linearUrl = value.match(/^https?:\/\/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]*-\d+)(?:\/|$|\?|#)/i);
  if (linearUrl) {
    return { tracker: 'linear', id: linearUrl[1].toUpperCase() };
  }
  const ghUrl = value.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)(?:\/|$|\?|#)/i);
  if (ghUrl) {
    return { tracker: 'github', repo: ghUrl[1], number: ghUrl[2] };
  }
  return { tracker: 'unsupported', raw: value };
}

function defaultLinearCaller(tool, args) {
  const payload = JSON.stringify({ name: `linear__${tool}`, arguments: args });
  let stdout;
  try {
    stdout = execFileSync('mcporter', ['call', 'magpie.call_tool', '--args', payload, '--output', 'json'], {
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const detail = (err && err.stderr && String(err.stderr).trim()) || (err && err.message) || String(err);
    throw new Error(`Linear MCP ${tool} 调用失败（需可用 mcporter/magpie）：${detail}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Linear MCP ${tool} 返回非 JSON 输出`);
  }
  if (parsed && parsed.isError) {
    const msg = Array.isArray(parsed.content)
      ? parsed.content.map((c) => c && c.text).filter(Boolean).join('; ')
      : 'isError';
    throw new Error(`Linear MCP ${tool} 拒绝执行：${msg}`);
  }
  if (parsed && typeof parsed.error === 'string') {
    throw new Error(`Linear MCP ${tool} 返回错误：${parsed.error}`);
  }
  return parsed;
}

function defaultGhRunner(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function pickLinearState(statuses, kind) {
  if (!Array.isArray(statuses) || statuses.length === 0) return null;
  if (kind === 'completed') {
    return statuses.find((s) => s.type === 'completed' && /^done$/i.test(s.name))
      || statuses.find((s) => s.type === 'completed')
      || null;
  }
  const started = statuses.filter((s) => s.type === 'started');
  if (kind === 'review') {
    return started.find((s) => /review/i.test(s.name)) || pickLinearState(statuses, 'started');
  }
  return started.find((s) => /in\s*progress/i.test(s.name))
    || started.find((s) => !/review/i.test(s.name))
    || started[0]
    || null;
}

function planLinearTransition(issue, statuses, target) {
  const { id, status, statusType } = issue;
  if (target === 'started') {
    if (TERMINAL_TYPES.has(statusType)) {
      throw new Error(`issue ${id} 已处于终态 "${status}" (${statusType})，拒绝登记为进行中`);
    }
    if (statusType === 'started') return { noop: true, expectedType: 'started' };
    const next = pickLinearState(statuses, 'started');
    if (!next) throw new Error(`Team 缺少 started 类型状态，无法将 ${id} 置为进行中`);
    return { noop: false, next, expectedType: 'started' };
  }
  if (target === 'review') {
    if (statusType === 'completed') return { noop: true, expectedType: 'completed' };
    if (TERMINAL_TYPES.has(statusType)) {
      throw new Error(`issue ${id} 已处于终态 "${status}" (${statusType})，拒绝推进到 review`);
    }
    const next = pickLinearState(statuses, 'review');
    if (!next) throw new Error(`Team 缺少 started/review 状态，无法推进 ${id}`);
    if (status === next.name && statusType === next.type) return { noop: true, expectedType: next.type };
    return { noop: false, next, expectedType: next.type, expectedName: next.name };
  }
  if (statusType === 'completed') return { noop: true, expectedType: 'completed' };
  if (TERMINAL_TYPES.has(statusType)) {
    throw new Error(`issue ${id} 处于 "${status}" (${statusType})，不能当作正式完成关闭`);
  }
  const next = pickLinearState(statuses, 'completed');
  if (!next) throw new Error(`Team 缺少 completed 类型状态，无法关闭 ${id}`);
  return { noop: false, next, expectedType: 'completed' };
}

function applyLinearTransition(callLinear, statusCache, issue, target) {
  if (!issue || !issue.id || !issue.teamId || !issue.statusType) {
    throw new Error(`Linear get_issue 返回缺少必需字段：${JSON.stringify(issue)}`);
  }
  let statuses = statusCache.get(issue.teamId);
  if (!statuses) {
    statuses = callLinear('list_issue_statuses', { team: issue.teamId });
    statusCache.set(issue.teamId, statuses);
  }
  const plan = planLinearTransition(issue, statuses, target);
  if (plan.noop) {
    return {
      issue: issue.id,
      previous_state: issue.status,
      state: issue.status,
      status_type: issue.statusType,
      changed: false,
    };
  }
  callLinear('save_issue', { id: issue.id, state: plan.next.id || plan.next.name });
  const after = callLinear('get_issue', { id: issue.id, fields: LINEAR_FIELDS });
  const typeOk = after && after.statusType === plan.expectedType;
  const nameOk = !plan.expectedName || (after && after.status === plan.expectedName);
  if (!typeOk || !nameOk) {
    const want = plan.expectedName ? `${plan.expectedName} (${plan.expectedType})` : plan.expectedType;
    const got = after ? `"${after.status}" (${after.statusType})` : 'empty';
    throw new Error(`issue ${issue.id} 状态回读校验失败：期望 ${want}，实际为 ${got}`);
  }
  return {
    issue: issue.id,
    previous_state: issue.status,
    state: after.status,
    status_type: after.statusType,
    changed: true,
  };
}

function promoteUnstartedParents(callLinear, statusCache, startParentId) {
  const promoted = [];
  const visited = new Set();
  let parentId = startParentId;
  for (let depth = 0; parentId && depth < MAX_PARENT_DEPTH; depth += 1) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = callLinear('get_issue', { id: parentId, fields: LINEAR_FIELDS });
    if (!parent || !UNSTARTED_TYPES.has(parent.statusType)) break;
    const res = applyLinearTransition(callLinear, statusCache, parent, 'started');
    promoted.push(res);
    parentId = parent.parentId || null;
  }
  return promoted;
}

function syncLinearIssue(ref, target, opts) {
  const callLinear = opts.callLinear || defaultLinearCaller;
  const statusCache = new Map();
  const issue = callLinear('get_issue', { id: ref.id, fields: LINEAR_FIELDS });
  const result = applyLinearTransition(callLinear, statusCache, issue, target);
  const parentsSynced = target === 'started' && opts.promoteParents !== false && issue.parentId
    ? promoteUnstartedParents(callLinear, statusCache, issue.parentId)
    : [];
  return {
    tracker: 'linear',
    ...result,
    parents_synced: parentsSynced,
  };
}

function syncGithubIssue(ref, target, opts) {
  const runGh = opts.runGh || defaultGhRunner;
  const readState = () => JSON.parse(
    runGh(['issue', 'view', ref.number, '--repo', ref.repo, '--json', 'state'])
  ).state;
  const current = readState();
  if (target === 'done') {
    if (current === 'CLOSED') {
      return {
        tracker: 'github', issue: `${ref.repo}#${ref.number}`,
        previous_state: current, state: 'CLOSED', status_type: 'completed', changed: false, parents_synced: [],
      };
    }
    runGh(['issue', 'close', ref.number, '--repo', ref.repo]);
    const after = readState();
    if (after !== 'CLOSED') {
      throw new Error(`GitHub issue ${ref.repo}#${ref.number} 关闭回读校验失败：实际为 ${after}`);
    }
    return {
      tracker: 'github', issue: `${ref.repo}#${ref.number}`,
      previous_state: current, state: after, status_type: 'completed', changed: true, parents_synced: [],
    };
  }
  if (current === 'CLOSED') {
    throw new Error(`GitHub issue ${ref.repo}#${ref.number} 已关闭，拒绝登记或推进为进行中`);
  }
  return {
    tracker: 'github', issue: `${ref.repo}#${ref.number}`,
    previous_state: current, state: current, status_type: 'started', changed: false, parents_synced: [],
  };
}

function syncIssueState(rawIssue, target, opts = {}) {
  if (!VALID_TARGETS.has(target)) {
    throw new Error(`invalid issue sync target "${target}"; allowed: ${[...VALID_TARGETS].join(', ')}`);
  }
  const ref = parseIssueRef(rawIssue);
  if (ref.tracker === 'linear') return syncLinearIssue(ref, target, opts);
  if (ref.tracker === 'github') return syncGithubIssue(ref, target, opts);
  throw new Error(`无法自动同步 issue "${rawIssue}" 的状态：仅支持 Linear key/URL 与 GitHub issue URL`);
}

module.exports = {
  VALID_TARGETS,
  parseIssueRef,
  planLinearTransition,
  syncIssueState,
};
