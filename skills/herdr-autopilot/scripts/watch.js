'use strict';

// ============================================================================
// L3-L6 Contract: herdr-autopilot event-driven watcher & T3 thread waker
// - Owns: single-instance PID dedup per (session, lane_id), blocking herdr agent wait,
//   stale-lane suppression on re-read, and T3 acp-mcp-call t3_thread_send wakeup.
// - Never holds the ledger file lock while waiting; never mutates the ledger.
// - Fail-close on missing --thread, non-active lane, or failed wake delivery.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const AFTER_PROMPT_WAIT_MS = 5000;

function sanitizeToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function pidPath(ledgerPath, session, laneId) {
  const dir = path.dirname(ledgerPath);
  return path.join(dir, `${sanitizeToken(session)}.watch.${sanitizeToken(laneId)}.pid`);
}

function logPath(ledgerPath, session, laneId) {
  const dir = path.dirname(ledgerPath);
  return path.join(dir, `${sanitizeToken(session)}.watch.${sanitizeToken(laneId)}.log`);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLivePid(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').trim();
  const pid = Number(raw);
  if (isPidAlive(pid)) return pid;
  try { fs.unlinkSync(file); } catch { /* ignore */ }
  return null;
}

function writePidFile(file, pid) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${pid}\n`, 'utf8');
}

function releaseOwnPid(file, pid = process.pid) {
  try {
    if (fs.existsSync(file) && Number(fs.readFileSync(file, 'utf8').trim()) === pid) {
      fs.unlinkSync(file);
    }
  } catch { /* ignore */ }
}

function stopWatcher(ledgerPath, session, laneId) {
  const file = pidPath(ledgerPath, session, laneId);
  const pid = readLivePid(file);
  if (pid && pid !== process.pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

function defaultT3Waker({ threadId, message }) {
  const nodeBin = process.env.T3_ACP_MCP_NODE;
  const entrypoint = process.env.T3_ACP_MCP_ENTRYPOINT;
  const endpoint = process.env.T3_ACP_MCP_ENDPOINT;
  const auth = process.env.T3_ACP_MCP_AUTHORIZATION;
  if (!nodeBin || !endpoint || !auth) {
    throw new Error(
      'missing T3 ACP MCP environment (T3_ACP_MCP_NODE/ENDPOINT/AUTHORIZATION); run watch from a T3 Code thread'
    );
  }
  const args = [
    ...(entrypoint ? [entrypoint] : []),
    'acp-mcp-call',
    't3_thread_send',
    JSON.stringify({ threadId, message, mode: 'auto' }),
  ];
  const stdout = execFileSync(nodeBin, args, {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(stdout);
  if (parsed && parsed.isError) {
    throw new Error(`t3_thread_send returned error: ${stdout.trim()}`);
  }
  return parsed;
}

function defaultDaemonSpawner(scriptPath, cliArgs, logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'a');
  try {
    const child = spawn(process.execPath, [scriptPath, ...cliArgs], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: process.env,
    });
    child.unref();
    return { pid: child.pid };
  } finally {
    fs.closeSync(fd);
  }
}

function spawnDaemonWatcher({
  ledgerPath,
  session,
  laneId,
  threadId,
  timeoutMs,
  afterPrompt,
  scriptPath,
  spawner = defaultDaemonSpawner,
}) {
  const pFile = pidPath(ledgerPath, session, laneId);
  const existing = readLivePid(pFile);
  if (existing) {
    return {
      watching: true,
      already_running: true,
      pid: existing,
      lane_id: laneId,
      thread_id: threadId,
    };
  }
  const lFile = logPath(ledgerPath, session, laneId);
  const cliArgs = [
    'watch',
    '--session', session,
    '--ledger', ledgerPath,
    '--id', laneId,
    '--thread', threadId,
    ...(timeoutMs ? ['--timeout', String(timeoutMs)] : []),
    ...(afterPrompt ? ['--after-prompt'] : []),
  ];
  const spawned = spawner(scriptPath, cliArgs, lFile);
  if (!spawned || !Number.isInteger(spawned.pid) || spawned.pid <= 0) {
    throw new Error('failed to spawn background watcher process');
  }
  writePidFile(pFile, spawned.pid);
  return {
    watching: true,
    already_running: false,
    pid: spawned.pid,
    lane_id: laneId,
    thread_id: threadId,
    log: lFile,
  };
}

function parseLiveState(rawList, agentName, paneId) {
  const parsed = JSON.parse(rawList);
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed?.result?.agents || parsed?.agents || []);
  const live = list.find((a) => a && (a.name === agentName || (paneId && a.pane_id === paneId)));
  if (!live) return 'missing';
  return live.agent_status || live.status || live.state || 'unknown';
}

function buildWakeMessage(lane, state, waitError) {
  const detail = waitError ? `${state} (${waitError})` : state;
  return [
    `[herdr-autopilot WAKE] lane ${lane.id} (${lane.issue || 'no-issue'}, agent=${lane.agent}, stage=${lane.stage}) 状态变为 ${detail}。`,
    '请立即运行 `node skills/herdr-autopilot/scripts/autopilot.js poll`，按 pause-triage 分诊回应；若自动回复后继续运行，重新挂 `watch --daemon --after-prompt`。',
  ].join(' ');
}

function watchLane({
  ledgerPath,
  session,
  lane,
  threadId,
  timeoutMs,
  afterPrompt,
  runner,
  waker = defaultT3Waker,
  reloadLane,
}) {
  const tid = String(threadId || '').trim();
  if (!tid) throw new Error('watch requires --thread <t3_thread_id>');
  if (lane.status !== 'active') {
    throw new Error(`lane "${lane.id}" is not active (status: ${lane.status})`);
  }

  const pFile = pidPath(ledgerPath, session, lane.id);
  const existing = readLivePid(pFile);
  if (existing && existing !== process.pid) {
    return { woke: false, reason: 'already_running', pid: existing, lane_id: lane.id, thread_id: tid };
  }
  writePidFile(pFile, process.pid);

  try {
    if (afterPrompt) {
      try {
        runner(session, ['agent', 'wait', lane.agent, '--until', 'working', '--timeout', String(AFTER_PROMPT_WAIT_MS)]);
      } catch {
        // Fast-finishing or immediately-blocked turns may skip observable working state.
      }
    }

    let waitError = null;
    const waitArgs = ['agent', 'wait', lane.agent, ...(timeoutMs ? ['--timeout', String(timeoutMs)] : [])];
    try {
      runner(session, waitArgs);
    } catch (err) {
      waitError = err.message || 'wait_failed';
    }

    const latest = reloadLane();
    if (!latest || latest.status !== 'active') {
      return { woke: false, reason: 'lane_no_longer_active', lane_id: lane.id, thread_id: tid };
    }

    let state = 'unknown';
    try {
      state = parseLiveState(runner(session, ['agent', 'list']), latest.agent, latest.pane);
    } catch {
      state = waitError ? 'wait_error' : 'unknown';
    }

    const message = buildWakeMessage(latest, state, waitError);
    waker({ threadId: tid, message, lane: latest, state });
    return {
      woke: true,
      lane_id: latest.id,
      issue: latest.issue || null,
      agent: latest.agent,
      stage: latest.stage,
      state,
      thread_id: tid,
    };
  } finally {
    releaseOwnPid(pFile, process.pid);
  }
}

module.exports = {
  watchLane,
  spawnDaemonWatcher,
  stopWatcher,
  defaultT3Waker,
  pidPath,
  logPath,
};
