#!/usr/bin/env node
'use strict';

// ============================================================================
// L3-L6 Contract: herdr-autopilot deterministic ledger & Herdr session poller
// - Owns: session validation, managed-lane allowlist ledger, circuit breaker, poll.
// - register --pane names the containing tab using --label or the lane id.
// - done 在登记的工作树和本地分支回收、pane 关闭后写入。
// - Defaults to "default" Herdr session; never reads or mutates unmanaged agents.
// - Stdout: strict JSON; errors: structured stderr + non-zero exit code.
// ============================================================================

const { ownedTree, closeout } = require('./closeout.js');
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
  const maxReplies = opts.maxReplies !== undefined ? Number(opts.maxReplies) : DEFAULT_MAX_REPLIES;
  if (!Number.isInteger(maxReplies) || maxReplies < 1) {
    throw new Error(`invalid --max-replies "${opts.maxReplies}"; must be integer >= 1`);
  }
  const now = new Date().toISOString();
  const lane = {
    id,
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

  for (const lane of Object.values(ledger.lanes)) {
    if (lane.status === 'done') continue;
    if (lane.status === 'awaiting_merge') {
      awaitingMerge.push({ id: lane.id, agent: lane.agent, stage: lane.stage, repo: lane.repo });
      continue;
    }
    if (lane.status === 'escalated') {
      escalated.push({
        id: lane.id,
        agent: lane.agent,
        stage: lane.stage,
        reason: lane.escalated_reason,
      });
      continue;
    }

    const live = byName.get(lane.agent) || (lane.pane ? byPane.get(lane.pane) : null);
    if (!live) {
      missing.push({ id: lane.id, agent: lane.agent, pane: lane.pane, stage: lane.stage });
      continue;
    }

    const state = live.agent_status || live.status || live.state || 'unknown';
    lane.last_observed_state = state;
    if (!lane.pane && live.pane_id) lane.pane = live.pane_id;

    if (state === 'working') {
      lane.consecutive_replies = 0;
      working.push({ id: lane.id, agent: lane.agent, stage: lane.stage, state });
      continue;
    }

    if (ATTENTION_STATES.has(state)) {
      const tailRaw = runner(session, [
        'agent',
        'read',
        lane.agent,
        '--source',
        'recent-unwrapped',
        '--lines',
        String(lines),
      ]);
      needsAttention.push({
        id: lane.id,
        agent: lane.agent,
        pane: lane.pane,
        stage: lane.stage,
        state,
        consecutive_replies: lane.consecutive_replies,
        max_consecutive_replies: lane.max_consecutive_replies,
        tail: extractReadText(tailRaw),
      });
      continue;
    }

    needsAttention.push({
      id: lane.id,
      agent: lane.agent,
      pane: lane.pane,
      stage: lane.stage,
      state,
      consecutive_replies: lane.consecutive_replies,
      max_consecutive_replies: lane.max_consecutive_replies,
      tail: '',
    });
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

function runCli(argv, runner = defaultHerdrRunner) {
  const { command, flags } = parseArgs(argv);
  if (!command || command === '--help' || command === '-h') {
    return {
      exitCode: 0,
      output: {
        commands: ['init', 'register', 'poll', 'record-reply', 'set-stage', 'escalate', 'resolve', 'list'],
        default_session: DEFAULT_SESSION,
      },
    };
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

  if (command === 'register') {
    const lane = registerLane(ledger, {
      id: flags.id,
      repo: flags.repo,
      worktree: flags.worktree,
      workspace: flags.workspace,
      pane: flags.pane,
      agent: flags.agent,
      stage: flags.stage,
      maxReplies: flags['max-replies'],
    });
    if (flags.label !== undefined && (!lane.pane || typeof flags.label !== 'string' || !flags.label.trim())) {
      throw new Error('--label requires --pane and a nonempty title');
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
      runner(session, ['tab', 'rename', pane.tab_id, flags.label || lane.id]);
    }
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output: lane };
  }

  if (command === 'poll') {
    const snapshot = pollLanes(ledger, session, { lines: flags.lines }, runner);
    saveLedger(ledgerPath, ledger);
    return { exitCode: 0, output: snapshot };
  }

  if (command === 'record-reply') {
    const res = recordReply(ledger, flags.id, flags.note);
    saveLedger(ledgerPath, ledger);
    return { exitCode: res.allowed ? 0 : 2, output: res };
  }

  if (command === 'set-stage') {
    if (flags.stage === 'done') {
      const current = requireLane(ledger, flags.id);
      const checkpoint = () => saveLedger(ledgerPath, ledger);
      try {
        closeout(current, session, runner, checkpoint);
      } catch (error) {
        escalateLane(ledger, flags.id, error.message);
        checkpoint();
        throw error;
      }
      current.escalated_reason = null;
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
function lockedCli(argv) {
  const { command, flags } = parseArgs(argv);
  if (!command || ['--help', '-h', 'list'].includes(command)) return runCli(argv);
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
