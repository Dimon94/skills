#!/usr/bin/env node
'use strict';

// ============================================================================
// L3-L6 Contract: herdr-autopilot deterministic ledger & Herdr session poller
// - Owns: session validation, managed-lane allowlist ledger, circuit breaker, poll, watch.
// - register --pane 强制可视化命名（"<Issue号> <中文简写>[ <英文>]"，拒绝裸 ASCII slug），同步命名 pane / tab（--keep-tab-label 保留共享四格 tab 名）；workspace 命名归 place。
// - launch 按 model-roles 配置启动 pane agent（见 launch.js）；register --pane 只接受 launch 过的 pane 并冻结 lane.launch。
// - 一个 Epic 独占一个 workspace：place 不收 --workspace，按 --epic（缺省取 --issue）复用账本或 herdr 中以 Epic 号开头的 workspace，没有就新建；register 拒绝跨 Epic 共用与同 Epic 分散，lane.epic 记入账本。
// - place 按 2x2 四格容量（每 tab 最多 4 pane：1->右、2->左下、3->右下、满 4 新开 -2）无抢焦点落位并命名。
// - register 必须带 --issue（issue key 或 URL），同步置为 In Progress（并推升未开始父项）且回读校验；poll 各栏带出 issue 与 issue_state。
// - poll 同一签名（等人栏的状态与原因，或待处理栏的 state@state_change_seq）只报一次，没变的进 unchanged 且不读尾部；全部没变即 quiet；--full 重报全量。
// - watch 把 lane 订阅给一个 T3 线程：当前状态记成基线，确保该线程的哨兵在跑（见 watch.js）。
// - poll --thread 是哨兵的一拍：只看该线程订阅的 active lane，只报订阅后新出现的状态；读不到 state_change_seq 即失败。
// - poll 把订阅了但哨兵已死的 lane 报进 unwatched。
// - set-stage --stage awaiting_merge 推进 issue 至 In Review（或保持进行中）并回读校验。
// - set-stage --stage done 在登记的工作树和本地分支回收、pane 关闭后，同步关闭直接 issue 至 Done 并回读校验（写任务除非显式 --keep-issue-open --reason），再写入 done 并清理 watcher。--keep-tree --reason 只跳过树回收，pane 照关。
// - poll 的 unreleased：status=done 但无 closed_at 且 pane 仍在，即绕过了 set-stage done。
// - sync-issue 供协调方同步子票状态（started | review | done）并回读校验，不持账本锁。
// - Defaults to "default" Herdr session; never reads or mutates unmanaged agents.
// - Stdout: strict JSON; errors: structured stderr + non-zero exit code.
// ============================================================================

const { ownedTree, closeout } = require('./closeout.js');
const { syncIssueState } = require('./issue-sync.js');
const { extractIssueKey, findEpicWorkspace, formatVisualLabel, placePane, MAX_TAB_COLS, MAX_PANE_COLS } = require('./layout.js');
const { ensureSentinel, sentinelAlive, runSentinel, lockedPoll, t3WakeEnv } = require('./watch.js');
const { launchAgent, claimLaunch } = require('./launch.js');
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

// 一个 Epic 独占一个 workspace：同 space 只容一个 Epic，同 Epic 只落一个 space。
// 缺 --epic 时以 lane 自身 issue 为 Epic；只看未回收的 lane。
function assertEpicWorkspace(ledger, { workspace, epic, self }) {
  const key = extractIssueKey(epic);
  if (!key) throw new Error(`invalid --epic "${epic}"; 需要 issue key 或 URL`);
  for (const other of Object.values(ledger.lanes)) {
    if (other === self || other.closed_at || other.status === 'done' || !other.workspace) continue;
    const otherKey = other.epic || extractIssueKey(other.issue);
    if (other.workspace === workspace && otherKey !== key) {
      throw new Error(`workspace "${workspace}" 已由 Epic ${otherKey}（lane ${other.id}）占用；Epic ${key} 须新建独立 workspace`);
    }
    if (other.workspace !== workspace && otherKey === key) {
      throw new Error(`Epic ${key} 已落在 workspace "${other.workspace}"（lane ${other.id}）；同一 Epic 的 lane 放回该 workspace`);
    }
  }
  return key;
}

function epicLaneWorkspace(ledger, epic) {
  const key = extractIssueKey(epic);
  return Object.values(ledger.lanes).find((l) => !l.closed_at && l.status !== 'done' && l.workspace &&
    (l.epic || extractIssueKey(l.issue)) === key)?.workspace || null;
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

function clearTerminalWatch(lane) {
  if (lane.status !== 'done' && lane.status !== 'awaiting_merge') return false;
  delete lane.wake_thread;
  delete lane.woken_sig;
  return true;
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
  clearTerminalWatch(lane);
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

// 把一条 lane 归栏，并给出「这个状态报过没有」的签名。
// working 和读不到 state_change_seq 的 lane 不签名：每次照报，不静默吞变化。
// detail 是惰性的：只有真要上报时才读尾部。
function classifyLane(lane, live, readTail) {
  if (lane.status === 'awaiting_merge') {
    return { bucket: 'awaiting_merge', sig: 'awaiting_merge', detail: () => ({ repo: lane.repo }) };
  }
  if (lane.status === 'escalated') {
    const reason = lane.escalated_reason;
    return { bucket: 'escalated', sig: `escalated:${reason}`, detail: () => ({ reason }) };
  }
  if (!live) return { bucket: 'missing', sig: 'missing', detail: () => ({ pane: lane.pane }) };

  const state = live.agent_status || live.status || live.state || 'unknown';
  if (state === 'working') return { bucket: 'working', sig: null, state, detail: () => ({ state }) };
  const seq = live.state_change_seq;
  return {
    bucket: 'needs_attention',
    sig: seq === undefined ? null : `${state}@${seq}`,
    state,
    detail: () => ({
      pane: lane.pane,
      state,
      consecutive_replies: lane.consecutive_replies,
      max_consecutive_replies: lane.max_consecutive_replies,
      tail: ATTENTION_STATES.has(state) ? readTail(lane) : '',
    }),
  };
}

// 每一栏都带 lane 身份：lane id、所服务的 issue 与最近同步状态、agent、阶段。
function view(lane, extra) {
  return {
    id: lane.id,
    issue: lane.issue || null,
    issue_state: lane.issue_state || null,
    agent: lane.agent,
    stage: lane.stage,
    ...extra,
  };
}

// 读一次 Herdr 现场，把 lane 归栏并记下观察到的状态。两种巡检共用。
function observer(session, opts, runner) {
  const lines = opts.lines !== undefined ? Number(opts.lines) : DEFAULT_READ_LINES;
  const { byName, byPane } = indexLiveAgents(extractAgentList(runner(session, ['agent', 'list'])));
  const readTail = (lane) => extractReadText(runner(session, [
    'agent', 'read', lane.agent, '--source', 'recent-unwrapped', '--lines', String(lines),
  ]));
  return (lane) => {
    const live = byName.get(lane.agent) || (lane.pane ? byPane.get(lane.pane) : null);
    if (live && !lane.pane && live.pane_id) lane.pane = live.pane_id;
    const seen = classifyLane(lane, live, readTail);
    if (seen.state) lane.last_observed_state = seen.state;
    if (seen.bucket === 'working') lane.consecutive_replies = 0;
    return seen;
  };
}

function noSeqError(lane) {
  return new Error(`lane "${lane.id}" 的 agent 没有 state_change_seq，哨兵分不清状态变没变；这条 lane 只能手动 poll`);
}

// 哨兵的一拍。记忆用 woken_sig，不和手动 poll 的 reported_sig 共用：
// 多个总控共用账本时，别人的 poll 不能吃掉这条 lane 的变化。
// escalated 仍算在 watching 里等恢复；清理旧账本里残留的终态订阅。
function sentinelPoll(ledger, session, threadId, opts, runner = defaultHerdrRunner) {
  const mine = [];
  for (const lane of Object.values(ledger.lanes)) {
    if (lane.wake_thread === threadId && !clearTerminalWatch(lane)) mine.push(lane);
  }
  const out = { session, thread: threadId, status: 'quiet', watching: mine.length, needs_attention: [], missing: [] };
  const active = mine.filter((lane) => lane.status === 'active');
  if (active.length === 0) return out;

  const observe = observer(session, opts, runner);
  for (const lane of active) {
    const { bucket, sig, detail } = observe(lane);
    if (bucket !== 'working' && sig === null) throw noSeqError(lane);
    if (lane.woken_sig === sig) continue;
    lane.woken_sig = sig;
    if (bucket === 'working') continue;
    lane.reported_sig = sig;
    out[bucket].push(view(lane, detail()));
  }
  if (out.needs_attention.length + out.missing.length > 0) out.status = 'attention';
  return out;
}

function pollLanes(ledger, session, opts, runner = defaultHerdrRunner) {
  const observe = observer(session, opts, runner);
  const alive = opts.alive || (() => true);
  let panes = null;
  const livePane = (id) => {
    if (!id) return false;
    panes ||= new Set(JSON.parse(runner(session, ['pane', 'list'])).result.panes.map((p) => p.pane_id));
    return panes.has(id);
  };
  const buckets = { working: [], needs_attention: [], escalated: [], awaiting_merge: [], missing: [], unchanged: [], unwatched: [], unreleased: [] };

  for (const lane of Object.values(ledger.lanes)) {
    // done 只能经 set-stage done 写入，它在 done 前关 pane 并盖 closed_at；没盖却 pane 还在，就是绕过了它。
    if (lane.status === 'done' && !lane.closed_at && livePane(lane.pane)) {
      buckets.unreleased.push(view(lane, { fix: `set-stage --id ${lane.id} --stage done（树要保留加 --keep-tree --reason）` }));
    }
    if (lane.status === 'done') continue;
    const { bucket, sig, detail } = observe(lane);
    // 订阅了却没有哨兵在看：这条 lane 的变化没人会来叫，每次都报，直到重新 watch。
    if (lane.wake_thread && !alive(lane.wake_thread)) buckets.unwatched.push(view(lane, { thread: lane.wake_thread }));

    // 同一签名只报一次：没变的 lane 只留身份，不读尾部，不占总控上下文。
    const reported = !opts.full && sig !== null && lane.reported_sig === sig;
    lane.reported_sig = sig;
    if (reported) buckets.unchanged.push(view(lane, { was: bucket }));
    else buckets[bucket].push(view(lane, detail()));
  }

  const hasActionable = ['needs_attention', 'escalated', 'awaiting_merge', 'missing', 'unwatched', 'unreleased']
    .some((key) => buckets[key].length > 0);
  return { session, status: hasActionable ? 'attention' : 'quiet', ...buckets };
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
        commands: ['init', 'place', 'launch', 'register', 'poll', 'watch', 'sentinel', 'record-reply', 'set-stage', 'sync-issue', 'escalate', 'resolve', 'list'],
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
    if (flags.workspace) {
      throw new Error('place 不接受 --workspace：按 --epic 自动复用或新建该 Epic 的 workspace');
    }
    const epic = flags.epic || issue;
    const workspace = epicLaneWorkspace(ledger, epic) || findEpicWorkspace(session, epic, runner);
    if (workspace) assertEpicWorkspace(ledger, { workspace, epic });
    const output = placePane({
      session,
      epic,
      workspace,
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

  if (command === 'launch') {
    const output = launchAgent(ledger, { stage: flags.stage, task: flags.task, agent: flags.agent, pane: flags.pane },
      { session, runner, planner: deps.planner });
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output };
  }

  if (command === 'register') {
    if (flags['workspace-label']) {
      throw new Error('register 不接受 --workspace-label：workspace 由 place 按 Epic 命名');
    }
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
      lane.launch = claimLaunch(ledger, lane.pane, lane.agent);
      const pane = JSON.parse(runner(session, ['pane', 'get', lane.pane])).result?.pane;
      if (pane?.pane_id !== lane.pane || !pane.tab_id || (lane.workspace && pane.workspace_id !== lane.workspace)) {
        throw new Error('cannot identify tab for the registered pane and workspace');
      }
      if (lane.cleanup && !pane.terminal_id) throw new Error('缺少 pane 身份');
      if (lane.cleanup?.tree && fs.realpathSync(pane.cwd) !== lane.cleanup.tree.path) {
        throw new Error('pane 启动目录与任务工作树不符');
      }
      lane.workspace = lane.workspace || pane.workspace_id || null;
      if (lane.workspace) {
        lane.epic = assertEpicWorkspace(ledger, { workspace: lane.workspace, epic: flags.epic || lane.issue, self: lane });
      }
      lane.terminal_id = pane.terminal_id;
      lane.pane_label = paneLabel;
      const syncRes = recordIssueSync(lane, issueSyncFn(lane.issue, 'started'));
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
    const opts = { lines: flags.lines, full: flags.full === true };
    opts.alive = deps.sentinelAlive || ((threadId) => sentinelAlive(ledgerPath, session, threadId));
    const snapshot = flags.thread
      ? sentinelPoll(ledger, session, String(flags.thread), opts, runner)
      : pollLanes(ledger, session, opts, runner);
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
    // 注入了 waker 的调用方自带通道；默认通道缺环境时不许订阅。
    if (!deps.waker) t3WakeEnv(deps.env);
    // 订阅这一刻的状态总控已经知道，记成基线：哨兵只报之后的变化。
    const { bucket, sig } = observer(session, {}, runner)(lane);
    if (bucket === 'missing') throw new Error(`lane "${lane.id}" 的 agent 不在 Herdr 里；先 launch 再 watch`);
    if (bucket !== 'working' && sig === null) throw noSeqError(lane);
    lane.wake_thread = threadId;
    lane.woken_sig = sig;
    saveLedger(ledgerPath, ledger);
    const sentinel = ensureSentinel({ ledgerPath, session, threadId, scriptPath: __filename, spawner: deps.spawner });
    return { exitCode: 0, output: { watching: true, lane_id: lane.id, thread_id: threadId, baseline: sig, sentinel } };
  }

  if (command === 'sentinel') {
    const threadId = String(flags.thread || '').trim();
    if (!threadId) throw new Error('sentinel requires --thread <t3_thread_id>');
    const poll = () => lockedPoll({ ledgerPath, session, threadId, scriptPath: __filename });
    const result = runSentinel({ threadId, poll });
    return { exitCode: result.exit, output: result };
  }

  if (command === 'record-reply') {
    const res = recordReply(ledger, flags.id, flags.note);
    saveLedger(ledgerPath, ledger);
    return { exitCode: res.allowed ? 0 : 2, output: res };
  }

  if (command === 'set-stage') {
    if (flags.stage === 'done') {
      const reason = String(flags.reason || '').trim();
      for (const flag of ['keep-issue-open', 'keep-tree']) {
        if (flags[flag] && !reason) throw new Error(`--${flag} requires --reason "<保留原因>"`);
      }
      const current = requireLane(ledger, flags.id);
      const checkpoint = () => saveLedger(ledgerPath, ledger);
      let issueSync = null;
      try {
        closeout(current, session, runner, checkpoint, flags['keep-tree'] ? reason : null);
        issueSync = syncLaneIssueOnDone(current, flags, issueSyncFn);
      } catch (error) {
        escalateLane(ledger, flags.id, error.message);
        checkpoint();
        throw error;
      }
      current.escalated_reason = null;
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
// sentinel 常驻不持锁，每拍另起一个持锁的 poll --thread。
function lockedCli(argv) {
  const { command, flags } = parseArgs(argv);
  if (!command || ['--help', '-h', 'list', 'sentinel', 'sync-issue'].includes(command)) return runCli(argv);
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
