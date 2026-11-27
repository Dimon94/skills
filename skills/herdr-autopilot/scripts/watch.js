'use strict';

// ============================================================================
// L3-L6 Contract: herdr-autopilot 哨兵（代码巡检，有变化才唤醒 T3 总控线程）
// - Owns: 每个 (session, T3 线程) 一个常驻进程的 pid 去重、定时巡检循环、
//   `t3 thread send` 唤醒、叫不醒时的系统通知。
// - 不读写账本：每拍经 autopilot.js `poll --thread` 拿结果，那条命令持账本锁。
// - 同一 lane 在连续巡检里重复出现的状态只唤醒一次；没有订阅 lane 即退出 0。
// - 唤醒消息是纯文本，自带巡检结果，不带 skill 调用。
// - Fail-close: 缺 T3 唤醒环境在订阅时失败；巡检连续失败 3 次通知人并退出 1；唤醒失败通知人并写日志。
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

const TICK_MS = 15000;
const MAX_POLL_FAILURES = 3;

function sanitizeToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function sentinelFile(ledgerPath, session, threadId, ext) {
  const name = `${sanitizeToken(session)}.sentinel.${sanitizeToken(threadId)}.${ext}`;
  return path.join(path.dirname(ledgerPath), name);
}

function readLivePid(file) {
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function sentinelAlive(ledgerPath, session, threadId) {
  return readLivePid(sentinelFile(ledgerPath, session, threadId, 'pid')) !== null;
}

// 唤醒通道的全部前提：T3 Code 给线程 shell 注入的 t3 CLI。订阅时和真正唤醒时读同一份，缺了就在订阅时失败。
function t3WakeEnv(env = process.env) {
  const cli = env.T3CODE_CLI_PATH;
  try {
    if (!cli) throw new Error('unset');
    fs.accessSync(cli, fs.constants.X_OK);
  } catch {
    throw new Error(`T3 wake channel unavailable: T3CODE_CLI_PATH (${cli || 'unset'}) is not an executable t3 CLI; run watch from a T3 Code thread`);
  }
  return { cli };
}

// `t3 thread send`：线程忙时排成下一轮，不打断。正文走 stdin，免得长巡检结果撑爆 argv。
function defaultT3Waker({ threadId, message }, env = process.env) {
  const { cli } = t3WakeEnv(env);
  try {
    return execFileSync(cli, ['thread', 'send', threadId, '-'], {
      encoding: 'utf8',
      input: message,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`t3 thread send failed: ${String(err.stderr || err.message).trim()}`);
  }
}

function defaultDaemonSpawner(scriptPath, cliArgs, logFile) {
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

// 调用方持账本锁，所以同一线程不会并发起两个哨兵。
function ensureSentinel({ ledgerPath, session, threadId, scriptPath, spawner = defaultDaemonSpawner }) {
  const pidFile = sentinelFile(ledgerPath, session, threadId, 'pid');
  const log = sentinelFile(ledgerPath, session, threadId, 'log');
  const existing = readLivePid(pidFile);
  if (existing) return { already_running: true, pid: existing, log };

  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  const cliArgs = ['sentinel', '--session', session, '--ledger', ledgerPath, '--thread', threadId];
  const spawned = spawner(scriptPath, cliArgs, log);
  if (!spawned || !Number.isInteger(spawned.pid) || spawned.pid <= 0) {
    throw new Error('failed to spawn sentinel process');
  }
  fs.writeFileSync(pidFile, `${spawned.pid}\n`, 'utf8');
  return { already_running: false, pid: spawned.pid, log };
}

function lockedPoll({ ledgerPath, session, threadId, scriptPath }) {
  const argv = [scriptPath, 'poll', '--session', session, '--ledger', ledgerPath, '--thread', threadId];
  try {
    return JSON.parse(execFileSync(process.execPath, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (err) {
    throw new Error(String(err.stderr || err.message).trim());
  }
}

function notifyHuman(text) {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), notify: text })}\n`);
  try {
    const script = `display notification ${JSON.stringify(text)} with title "herdr-autopilot"`;
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
  } catch { /* 没有 osascript 的机器只留日志 */ }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function wakeChanges(snapshot, previous) {
  const current = new Map();
  const changed = {};
  for (const bucket of ['needs_attention', 'missing']) {
    changed[bucket] = snapshot[bucket].filter((lane) => {
      const state = { bucket, lane };
      current.set(lane.id, state);
      return !isDeepStrictEqual(previous.get(lane.id), state);
    });
  }
  return { current, changed };
}

function wakeMessage(changed) {
  const count = changed.needs_attention.length + changed.missing.length;
  return [
    `[herdr-autopilot WAKE] ${count} 条 lane 状态变了。下面就是这次巡检结果，不用再跑 poll；按暂停分诊处理。`,
    JSON.stringify(changed, null, 1),
  ].join('\n');
}

// 一拍 = 一次持锁巡检。只有巡检报出变化才碰模型。
function runSentinel({ threadId, poll, wake = defaultT3Waker, notify = notifyHuman, sleep = () => sleepSync(TICK_MS) }) {
  let previous = new Map();
  for (let failures = 0; ; sleep()) {
    let snapshot;
    try {
      snapshot = poll();
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures < MAX_POLL_FAILURES) continue;
      notify(`哨兵连续 ${failures} 次巡检失败，已退出（线程 ${threadId}）：${err.message}`);
      return { exit: 1, reason: 'poll_failed' };
    }
    if (snapshot.watching === 0) return { exit: 0, reason: 'nothing_watched' };
    if (snapshot.status !== 'attention') {
      previous.clear();
      continue;
    }
    const { current, changed } = wakeChanges(snapshot, previous);
    previous = current;
    if (!changed.needs_attention.length && !changed.missing.length) continue;
    try {
      wake({ threadId, message: wakeMessage(changed) });
    } catch (err) {
      notify(`lane 状态变了但叫不醒线程 ${threadId}：${err.message}。回到总控线程跑 poll --full。`);
    }
  }
}

module.exports = {
  ensureSentinel,
  sentinelAlive,
  runSentinel,
  lockedPoll,
  t3WakeEnv,
  defaultT3Waker,
};
