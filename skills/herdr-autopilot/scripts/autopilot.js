#!/usr/bin/env node
'use strict';

// ============================================================================
// L3-L6 Contract: herdr-autopilot deterministic ledger & Herdr session poller
// - Owns: session validation, managed-lane allowlist ledger, circuit breaker, poll, watch.
// - register --pane 强制可视化命名（"<Issue号> <中文简写>[ <英文>]"，拒绝裸 ASCII slug），同步命名 pane / tab（--keep-tab-label 保留共享四格 tab 名）/ 可选 workspace。
// - place 按 2x2 四格容量（每 tab 最多 4 pane：1->右、2->左下、3->右下、满 4 新开 -2）无抢焦点落位并命名。
// - register 必须带 --issue（issue key 或 URL），同步置为 In Progress（并推升未开始父项）且回读校验；poll 各栏带出 issue 与 issue_state。
// - watch 以 herdr agent wait 阻塞等终态/阻断态并主动唤醒 T3 主会话，不持账本锁。
// - set-stage --stage awaiting_merge 推进 issue 至 In Review（或保持进行中）并回读校验。
// - set-stage --stage done 在登记的工作树和本地分支回收、pane 关闭后，同步关闭直接 issue 至 Done 并回读校验（写任务除非显式 --keep-issue-open --reason），再写入 done 并清理 watcher。
// - sync-issue 供协调方同步子票状态（started | review | done）并回读校验，不持账本锁。
// - Defaults to "default" Herdr session; never reads or mutates unmanaged agents.
// - Stdout: strict JSON; errors: structured stderr + non-zero exit code.
// ============================================================================

const { ownedTree, closeout } = require('./closeout.js');
const { syncIssueState } = require('./issue-sync.js');
const { formatVisualLabel, placePane, MAX_WORKSPACE_COLS, MAX_TAB_COLS, MAX_PANE_COLS } = require('./layout.js');
const { watchLane, spawnDaemonWatcher, stopWatcher } = require('./watch.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const DEFAULT_SESSION = 'default';
const DEFAULT_MAX_REPLIES = 3;
const DEFAULT_READ_LINES = 60;
const VALID_STAGES = new Set([
  'epic',
  'spec',
  'tickets',
  'pipeline',
  'bugfix',
  'awaiting_merge',
  'done',
]);
const ATTENTION_STATES = new Set(['idle', 'done', 'blocked']);
const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const SESSION_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const ISSUE_RE = /^(?:[A-Z][A-Z0-9]*-\d+|https?:\/\/\S+)$/;

function validateSession(session) {
  const value = String(session || '').trim();
  if (!value) {
    throw new Error('session is required and cannot be empty; pass --session <name>');
  }
  if (!SESSION_NAME_RE.test(value)) {
    throw new Error(`invalid session name "${value}": use [a-zA-Z0-9._-]`);
  }
  return value;
}

function defaultLedgerPath(session) {
  return path.join(os.homedir(), '.config', 'herdr-autopilot', `${session}.json`);
}

function emptyLedger(session) {
  return {
    version: 1,
    session,
    updated_at: new Date().toISOString(),
    lanes: {},
  };
}

function loadLedger(ledgerPath, session) {
  if (!fs.existsSync(ledgerPath)) {
    return emptyLedger(session);
  }
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.lanes !== 'object') {
    throw new Error(`corrupt ledger at ${ledgerPath}: missing lanes object`);
  }
  if (parsed.session && parsed.session !== session) {
    throw new Error(
      `ledger session mismatch at ${ledgerPath}: ledger has "${parsed.session}", got "${session}"`
    );
  }
  return parsed;
}

function saveLedger(ledgerPath, ledger) {
  const dir = path.dirname(ledgerPath);
  fs.mkdirSync(dir, { recursive: true });
  ledger.updated_at = new Date().toISOString();
  const tmpPath = `${ledgerPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, ledgerPath);
}

function defaultHerdrRunner(session, args) {
  const cliArgs = session === DEFAULT_SESSION ? args : ['--session', session, ...args];
  const stdout = execFileSync('herdr', cliArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return stdout;
}

function extractAgentList(rawOutput) {
  const parsed = JSON.parse(rawOutput);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && parsed.result && Array.isArray(parsed.result.agents)) {
    return parsed.result.agents;
  }
  if (parsed && Array.isArray(parsed.agents)) return parsed.agents;
  throw new Error('unexpected herdr agent list JSON shape');
}

function extractReadText(rawOutput) {
  const trimmed = String(rawOutput || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed;
    if (parsed && parsed.result && typeof parsed.result.text === 'string') {
      return parsed.result.text;
    }
    if (parsed && typeof parsed.text === 'string') return parsed.text;
  } catch {
    // Plain text output from herdr agent read
  }
  return trimmed;
}

function registerLane(ledger, opts) {
  const id = String(opts.id || '').trim();
  if (!id) throw new Error('register requires --id');
  if (ledger.lanes[id]) throw new Error(`lane "${id}" already exists in ledger`);
  const stage = String(opts.stage || '').trim();
  if (!VALID_STAGES.has(stage)) {
    throw new Error(`invalid stage "${stage}"; allowed: ${[...VALID_STAGES].join(', ')}`);
  }
  const agent = String(opts.agent || '').trim();
  if (!AGENT_NAME_RE.test(agent)) {
    throw new Error(`invalid agent name "${agent}"; must match ${AGENT_NAME_RE}`);
  }
  const issue = String(opts.issue || '').trim();
  if (!ISSUE_RE.test(issue)) {
    throw new Error(`register requires --issue <issue key 或 URL>，记录本 lane 服务的 Epic/Spec/ticket；got "${issue}"`);
  }
  const maxReplies = opts.maxReplies !== undefined ? Number(opts.maxReplies) : DEFAULT_MAX_REPLIES;
  if (!Number.isInteger(maxReplies) || maxReplies < 1) {
    throw new Error(`invalid --max-replies "${opts.maxReplies}"; must be integer >= 1`);
  }
  const now = new Date().toISOString();
  const lane = {
    id,
    issue,
    repo: opts.repo || null,
    worktree: opts.worktree || null,
    workspace: opts.workspace || null,
    pane: opts.pane || null,
    agent,
    stage,
    status: 'active',
    consecutive_replies: 0,
    max_consecutive_replies: maxReplies,
    escalated_reason: null,
    last_observed_state: null,
    last_reply_note: null,
    created_at: now,
    updated_at: now,
  };
  ledger.lanes[id] = lane;
  return lane;
}

function requireLane(ledger, id) {
  const lane = ledger.lanes[id];
  if (!lane) throw new Error(`lane "${id}" not found in ledger`);
  return lane;
}

function recordReply(ledger, id, note) {
  const lane = requireLane(ledger, id);
  if (lane.status === 'escalated') {
    return {
      allowed: false,
      reason: 'already_escalated',
      lane_id: id,
      escalated_reason: lane.escalated_reason,
    };
  }
  const nextCount = lane.consecutive_replies + 1;
  if (nextCount > lane.max_consecutive_replies) {
    lane.status = 'escalated';
    lane.escalated_reason = `circuit_breaker: exceeded ${lane.max_consecutive_replies} consecutive auto-replies at stage "${lane.stage}"`;
    lane.updated_at = new Date().toISOString();
    return {
      allowed: false,
      reason: 'circuit_breaker',
      lane_id: id,
      consecutive_replies: lane.consecutive_replies,
      max_consecutive_replies: lane.max_consecutive_replies,
      escalated_reason: lane.escalated_reason,
    };
  }
  lane.consecutive_replies = nextCount;
  lane.last_reply_note = note || null;
  lane.updated_at = new Date().toISOString();
  return {
    allowed: true,
    lane_id: id,
    consecutive_replies: lane.consecutive_replies,
    remaining: lane.max_consecutive_replies - lane.consecutive_replies,
  };
}

function setStage(ledger, id, stage) {
  if (!VALID_STAGES.has(stage)) {
    throw new Error(`invalid stage "${stage}"; allowed: ${[...VALID_STAGES].join(', ')}`);
  }
  const lane = requireLane(ledger, id);
  lane.stage = stage;
  lane.consecutive_replies = 0;
  if (stage === 'done') {
    lane.status = 'done';
  } else if (stage === 'awaiting_merge') {
    lane.status = 'awaiting_merge';
  } else if (lane.status !== 'escalated') {
    lane.status = 'active';
  }
  lane.updated_at = new Date().toISOString();
  return lane;
}

function escalateLane(ledger, id, reason) {
  const lane = requireLane(ledger, id);
  const text = String(reason || '').trim();
  if (!text) throw new Error('escalate requires --reason');
  lane.status = 'escalated';
  lane.escalated_reason = text;
  lane.updated_at = new Date().toISOString();
  return lane;
}

function resolveLane(ledger, id) {
  const lane = requireLane(ledger, id);
  lane.status = lane.stage === 'done' ? 'done' : 'active';
  lane.escalated_reason = null;
  lane.consecutive_replies = 0;
  lane.updated_at = new Date().toISOString();
  return lane;
}

function indexLiveAgents(agents) {
  const byName = new Map();
  const byPane = new Map();
  for (const agent of agents) {
    if (agent && agent.name) byName.set(agent.name, agent);
    if (agent && agent.pane_id) byPane.set(agent.pane_id, agent);
  }
  return { byName, byPane };
}

function pollLanes(ledger, session, opts, runner = defaultHerdrRunner) {
  const lines = opts.lines !== undefined ? Number(opts.lines) : DEFAULT_READ_LINES;
  const rawList = runner(session, ['agent', 'list']);
  const liveAgents = extractAgentList(rawList);
  const { byName, byPane } = indexLiveAgents(liveAgents);

  const working = [];
  const needsAttention = [];
  const escalated = [];
  const awaitingMerge = [];
  const missing = [];

  // 每一栏都带 lane 身份：lane id、所服务的 issue 与最近同步状态、agent、阶段。
  const view = (lane, extra) => ({
    id: lane.id,
    issue: lane.issue || null,
    issue_state: lane.issue_state || null,
    agent: lane.agent,
    stage: lane.stage,
    ...extra,
  });
  const readTail = (lane) => extractReadText(runner(session, [
    'agent', 'read', lane.agent, '--source', 'recent-unwrapped', '--lines', String(lines),
  ]));

  for (const lane of Object.values(ledger.lanes)) {
    if (lane.status === 'done') continue;
    if (lane.status === 'awaiting_merge') {
      awaitingMerge.push(view(lane, { repo: lane.repo }));
      continue;
    }
    if (lane.status === 'escalated') {
      escalated.push(view(lane, { reason: lane.escalated_reason }));
      continue;
    }

    const live = byName.get(lane.agent) || (lane.pane ? byPane.get(lane.pane) : null);
    if (!live) {
      missing.push(view(lane, { pane: lane.pane }));
      continue;
    }

    const state = live.agent_status || live.status || live.state || 'unknown';
    lane.last_observed_state = state;
    if (!lane.pane && live.pane_id) lane.pane = live.pane_id;

    if (state === 'working') {
      lane.consecutive_replies = 0;
      working.push(view(lane, { state }));
      continue;
    }

    needsAttention.push(view(lane, {
      pane: lane.pane,
      state,
      consecutive_replies: lane.consecutive_replies,
      max_consecutive_replies: lane.max_consecutive_replies,
      tail: ATTENTION_STATES.has(state) ? readTail(lane) : '',
    }));
  }

  const hasActionable =
    needsAttention.length > 0 || escalated.length > 0 || awaitingMerge.length > 0 || missing.length > 0;

  return {
    session,
    status: hasActionable ? 'attention' : 'quiet',
    working,
    needs_attention: needsAttention,
    escalated,
    awaiting_merge: awaitingMerge,
    missing,
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument "${token}"`);
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { command, flags };
}

function recordIssueSync(lane, syncResult) {
  lane.issue_state = syncResult.state;
  lane.issue_status_type = syncResult.status_type;
  lane.issue_sync_at = new Date().toISOString();
  return syncResult;
}

function syncLaneIssueOnDone(lane, flags, issueSyncFn) {
  const isPaneOnly = Boolean(lane.cleanup && !lane.cleanup.tree);
  if (flags['keep-issue-open']) {
    const reason = String(flags.reason || '').trim();
    if (!reason) throw new Error('--keep-issue-open requires --reason "<保留原因>"');
    lane.issue_kept_open_reason = reason;
    return recordIssueSync(lane, issueSyncFn(lane.issue, 'review'));
  }
  if (isPaneOnly && !flags['close-issue']) {
    return null;
  }
  return recordIssueSync(lane, issueSyncFn(lane.issue, 'done'));
}

function runCli(argv, runner = defaultHerdrRunner, deps = {}) {
  const { command, flags } = parseArgs(argv);
  const issueSyncFn = deps.issueSync || syncIssueState;
  if (!command || command === '--help' || command === '-h') {
    return {
      exitCode: 0,
      output: {
        commands: ['init', 'place', 'register', 'poll', 'watch', 'record-reply', 'set-stage', 'sync-issue', 'escalate', 'resolve', 'list'],
        default_session: DEFAULT_SESSION,
      },
    };
  }

  if (command === 'sync-issue') {
    const issue = String(flags.issue || '').trim();
    if (!ISSUE_RE.test(issue)) {
      throw new Error(`sync-issue requires --issue <issue key 或 URL>; got "${issue}"`);
    }
    const target = String(flags.target || '').trim();
    return { exitCode: 0, output: issueSyncFn(issue, target) };
  }

  const session = validateSession(flags.session || DEFAULT_SESSION);
  const ledgerPath = flags.ledger || defaultLedgerPath(session);
  const ledger = loadLedger(ledgerPath, session);

  if (command === 'init') {
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output: { session, ledger: ledgerPath, lane_count: Object.keys(ledger.lanes).length } };
  }

  if (command === 'list') {
    return { exitCode: 0, output: { session, ledger: ledgerPath, lanes: Object.values(ledger.lanes) } };
  }

  if (command === 'place') {
    const issue = String(flags.issue || '').trim();
    if (!ISSUE_RE.test(issue)) {
      throw new Error(`place requires --issue <issue key 或 URL>; got "${issue}"`);
    }
    const output = placePane({
      session,
      workspace: flags.workspace,
      cwd: flags.cwd,
      issue,
      tabPrefix: flags['tab-prefix'],
      paneLabel: flags['pane-label'] || flags.label,
      workspaceLabel: flags['workspace-label'],
      excludeTab: flags['exclude-tab'],
      runner,
    });
    return { exitCode: 0, output };
  }

  if (command === 'register') {
    const lane = registerLane(ledger, {
      id: flags.id,
      repo: flags.repo,
      worktree: flags.worktree,
      workspace: flags.workspace,
      pane: flags.pane,
      agent: flags.agent,
      issue: flags.issue,
      stage: flags.stage,
      maxReplies: flags['max-replies'],
    });
    if ((flags.label !== undefined || flags['pane-label'] !== undefined) && !lane.pane) {
      throw new Error('--label / --pane-label requires --pane');
    }
    let paneLabel = null;
    let tabLabel = null;
    let workspaceLabel = null;
    if (lane.pane) {
      paneLabel = formatVisualLabel({
        issue: lane.issue,
        label: flags['pane-label'] || flags.label,
        maxCols: MAX_PANE_COLS,
        kind: 'pane',
      });
      if (flags['tab-label'] || (!flags['keep-tab-label'] && flags.label)) {
        tabLabel = formatVisualLabel({
          issue: lane.issue,
          label: flags['tab-label'] || flags.label,
          maxCols: MAX_TAB_COLS,
          kind: 'tab',
        });
      }
      if (flags['workspace-label']) {
        workspaceLabel = formatVisualLabel({
          issue: lane.issue,
          label: flags['workspace-label'],
          maxCols: MAX_WORKSPACE_COLS,
          kind: 'workspace',
        });
      }
    }
    if (flags.worktree || flags.base || flags['pane-only']) {
      if (!lane.pane || (flags['pane-only'] && (flags.worktree || flags.base))) {
        throw new Error('登记工作树或 --pane-only 时需要唯一 pane');
      }
      lane.cleanup = flags['pane-only'] ? {} : { tree: ownedTree(lane.repo, flags.worktree, flags.base) };
      if (Object.values(ledger.lanes).some(other => other !== lane && !other.closed_at &&
          (other.pane === lane.pane || (lane.cleanup.tree && other.cleanup?.tree?.path === lane.cleanup.tree.path)))) {
        throw new Error('资源已由其他 lane 登记');
      }
    }
    if (lane.pane) {
      const pane = JSON.parse(runner(session, ['pane', 'get', lane.pane])).result?.pane;
      if (pane?.pane_id !== lane.pane || !pane.tab_id || (lane.workspace && pane.workspace_id !== lane.workspace)) {
        throw new Error('cannot identify tab for the registered pane and workspace');
      }
      if (lane.cleanup && !pane.terminal_id) throw new Error('缺少 pane 身份');
      if (lane.cleanup?.tree && fs.realpathSync(pane.cwd) !== lane.cleanup.tree.path) {
        throw new Error('pane 启动目录与任务工作树不符');
      }
      lane.terminal_id = pane.terminal_id;
      lane.pane_label = paneLabel;
      const syncRes = recordIssueSync(lane, issueSyncFn(lane.issue, 'started'));
      if (workspaceLabel && pane.workspace_id) {
        runner(session, ['workspace', 'rename', pane.workspace_id, workspaceLabel]);
      }
      if (tabLabel) {
        runner(session, ['tab', 'rename', pane.tab_id, tabLabel]);
      }
      runner(session, ['pane', 'rename', lane.pane, paneLabel]);
      saveLedger(ledgerPath, ledger);
      return { exitCode: 0, output: { ...lane, issue_sync: syncRes } };
    }
    const syncRes = recordIssueSync(lane, issueSyncFn(lane.issue, 'started'));
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output: { ...lane, issue_sync: syncRes } };
  }

  if (command === 'poll') {
    const snapshot = pollLanes(ledger, session, { lines: flags.lines }, runner);
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output: snapshot };
  }

  if (command === 'watch') {
    const lane = requireLane(ledger, flags.id);
    const threadId = String(flags.thread || '').trim();
    if (!threadId) throw new Error('watch requires --thread <t3_thread_id>');
    if (lane.status !== 'active') {
      throw new Error(`lane "${lane.id}" is not active (status: ${lane.status})`);
    }
    const timeoutMs = flags.timeout !== undefined ? Number(flags.timeout) : undefined;
    if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) {
      throw new Error(`invalid --timeout "${flags.timeout}"; must be integer >= 1`);
    }
    if (flags.daemon) {
      const output = spawnDaemonWatcher({
        ledgerPath,
        session,
        laneId: lane.id,
        threadId,
        timeoutMs,
        afterPrompt: Boolean(flags['after-prompt']),
        scriptPath: __filename,
        spawner: deps.spawner,
      });
      return { exitCode: 0, output };
    }
    const output = watchLane({
      ledgerPath,
      session,
      lane,
      threadId,
      timeoutMs,
      afterPrompt: Boolean(flags['after-prompt']),
      runner,
      waker: deps.waker,
      reloadLane: () => loadLedger(ledgerPath, session).lanes[lane.id] || null,
    });
    return { exitCode: 0, output };
  }

  if (command === 'record-reply') {
    const res = recordReply(ledger, flags.id, flags.note);
    saveLedger(ledgerPath, ledger);
    return { exitCode: res.allowed ? 0 : 2, output: res };
  }

  if (command === 'set-stage') {
    if (flags.stage === 'done') {
      if (flags['keep-issue-open'] && !String(flags.reason || '').trim()) {
        throw new Error('--keep-issue-open requires --reason "<保留原因>"');
      }
      const current = requireLane(ledger, flags.id);
      const checkpoint = () => saveLedger(ledgerPath, ledger);
      let issueSync = null;
      try {
        closeout(current, session, runner, checkpoint);
        issueSync = syncLaneIssueOnDone(current, flags, issueSyncFn);
      } catch (error) {
        escalateLane(ledger, flags.id, error.message);
        checkpoint();
        throw error;
      }
      current.escalated_reason = null;
      stopWatcher(ledgerPath, session, flags.id);
      const lane = setStage(ledger, flags.id, flags.stage);
      saveLedger(ledgerPath, ledger);
      return { exitCode: 0, output: issueSync ? { ...lane, issue_sync: issueSync } : lane };
    }
    if (flags.stage === 'awaiting_merge') {
      const current = requireLane(ledger, flags.id);
      const issueSync = recordIssueSync(current, issueSyncFn(current.issue, 'review'));
      const lane = setStage(ledger, flags.id, flags.stage);
      saveLedger(ledgerPath, ledger);
      return { exitCode: 0, output: { ...lane, issue_sync: issueSync } };
    }
    const lane = setStage(ledger, flags.id, flags.stage);
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output: lane };
  }

  if (command === 'escalate') {
    const lane = escalateLane(ledger, flags.id, flags.reason);
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output: lane };
  }

  if (command === 'resolve') {
    const lane = resolveLane(ledger, flags.id);
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output: lane };
  }

  throw new Error(`unknown command "${command}"`);
}

// 进程锁覆盖账本的读取、外部动作和落盘；内核在进程退出时释放锁。
// watch 对账本只读且会长期阻塞等待 Herdr 状态变化，不持账本锁以避免死锁。
function lockedCli(argv) {
  const { command, flags } = parseArgs(argv);
  if (!command || ['--help', '-h', 'list', 'watch', 'sync-issue'].includes(command)) return runCli(argv);
  const ledger = flags.ledger || defaultLedgerPath(validateSession(flags.session || DEFAULT_SESSION));
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  const mac = process.platform === 'darwin';
  const args = [...(mac ? ['-k'] : []), ledger + '.lock', process.execPath, __filename, '--locked', ...argv];
  const child = spawnSync(mac ? 'lockf' : 'flock', args, { stdio: 'inherit' });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

if (require.main === module) {
  try {
    const { exitCode, output } = process.argv[2] === '--locked'
      ? runCli(process.argv.slice(3)) : lockedCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exit(exitCode);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

module.exports = {
  validateSession,
  registerLane,
  recordReply,
  setStage,
  escalateLane,
  resolveLane,
  pollLanes,
  runCli,
};
