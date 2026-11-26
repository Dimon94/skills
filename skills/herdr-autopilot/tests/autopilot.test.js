'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateSession, runCli: rawRunCli } = require('../scripts/autopilot.js');
const { syncIssueState, parseIssueRef } = require('../scripts/issue-sync.js');
const { displayWidth, formatVisualLabel } = require('../scripts/layout.js');
const { runSentinel } = require('../scripts/watch.js');

function stubIssueSync(issue, target) {
  const map = {
    started: { state: 'In Progress', status_type: 'started' },
    review: { state: 'In Review', status_type: 'started' },
    done: { state: 'Done', status_type: 'completed' },
  };
  return { tracker: 'linear', issue, previous_state: 'Backlog', changed: true, parents_synced: [], ...map[target] };
}

const T3_ENV = { T3_ACP_MCP_NODE: 'node', T3_ACP_MCP_ENDPOINT: 'http://t3', T3_ACP_MCP_AUTHORIZATION: 'token' };

function runCli(argv, runner, deps = {}) {
  return rawRunCli(argv, runner, { issueSync: stubIssueSync, env: T3_ENV, ...deps });
}

// 替身 planner 模拟 model_config.py：planning 配的是 claude / Opus 5.5。
function fakePlanner({ task, workerName, paneId }) {
  const triple = task === 'planning' ? ['claude', 'claude-opus-5-5', 'medium'] : ['pi', 'gpt-6.2-sol', 'high'];
  return { agent: triple[0], model: triple[1], effort: triple[2],
    argv: ['herdr', 'agent', 'start', workerName, '--kind', triple[0], '--pane', paneId, '--', '--model', triple[1]] };
}

function launched(ledger, pane, agent, extra = ['--stage', 'spec']) {
  const calls = [];
  const res = rawRunCli(['launch', '--ledger', ledger, '--pane', pane, '--agent', agent, ...extra],
    (_s, args) => { calls.push(args); return ''; }, { planner: fakePlanner });
  return { ...res, calls };
}

function makeTempLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-autopilot-'));
  return path.join(dir, 'autopilot.json');
}

test('validateSession accepts default and named sessions, rejects empty/invalid', () => {
  assert.equal(validateSession('default'), 'default');
  assert.equal(validateSession('autopilot'), 'autopilot');
  assert.throws(() => validateSession(''), /cannot be empty/);
  assert.throws(() => validateSession('bad session!'), /invalid session name/);
});

test('poll defaults to default session, ignores unmanaged agents, and only reads non-working managed lanes', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--issue', 'DD-1',
    '--ledger', ledgerPath,
    '--id', 'feat-a',
    '--agent', 'auto-feat-a',
    '--stage', 'spec',
    '--repo', '/tmp/repo-a',
  ]);
  runCli([
    'register',
    '--issue', 'DD-1',
    '--ledger', ledgerPath,
    '--id', 'feat-b',
    '--agent', 'auto-feat-b',
    '--stage', 'pipeline',
    '--repo', '/tmp/repo-b',
  ]);

  const calls = [];
  const fakeRunner = (session, args) => {
    calls.push([session, ...args]);
    if (args[0] === 'agent' && args[1] === 'list') {
      return JSON.stringify({
        result: {
          agents: [
            { name: 'manual-human-pane', pane_id: 'w1:p1', agent_status: 'idle' },
            { name: 'auto-feat-a', pane_id: 'w2:p1', agent_status: 'working' },
            { name: 'auto-feat-b', pane_id: 'w2:p2', agent_status: 'done' },
          ],
        },
      });
    }
    if (args[0] === 'agent' && args[1] === 'read' && args[2] === 'auto-feat-b') {
      return JSON.stringify({ result: { text: 'Spec ready. Run /to-tickets next.' } });
    }
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };

  const res = runCli(['poll', '--ledger', ledgerPath], fakeRunner);
  assert.equal(res.exitCode, 0);
  assert.equal(res.output.session, 'default');
  assert.equal(res.output.status, 'attention');
  assert.equal(res.output.working.length, 1);
  assert.equal(res.output.working[0].id, 'feat-a');
  assert.equal(res.output.needs_attention.length, 1);
  assert.equal(res.output.needs_attention[0].id, 'feat-b');
  assert.match(res.output.needs_attention[0].tail, /\/to-tickets/);
  // Must never read manual-human-pane or working auto-feat-a
  const readTargets = calls.filter((c) => c[2] === 'read').map((c) => c[3]);
  assert.deepEqual(readTargets, ['auto-feat-b']);
});

test('poll returns quiet when all managed lanes are working', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--issue', 'DD-1',
    '--session', 'autopilot',
    '--ledger', ledgerPath,
    '--id', 'feat-a',
    '--agent', 'auto-feat-a',
    '--stage', 'pipeline',
  ]);

  const fakeRunner = (_session, args) => {
    if (args[1] === 'list') {
      return JSON.stringify({ result: { agents: [{ name: 'auto-feat-a', pane_id: 'w1:p1', status: 'working' }] } });
    }
    throw new Error('should not read working agent');
  };

  const res = runCli(['poll', '--session', 'autopilot', '--ledger', ledgerPath], fakeRunner);
  assert.equal(res.exitCode, 0);
  assert.equal(res.output.status, 'quiet');
  assert.equal(res.output.working.length, 1);
  assert.equal(res.output.needs_attention.length, 0);
});

// 重放 2026-11-24/25 的真实现场：ads-links 停在 idle、另一条 lane 已升级等人，
// 164 次定时巡检没有一次 quiet，每次都重发整段尾部。
test('poll goes quiet on the second look at unchanged lanes and reports them once', () => {
  const ledgerPath = makeTempLedger();
  const base = ['--session', 'autopilot', '--ledger', ledgerPath];
  runCli(['register', '--issue', 'DD-1', ...base, '--id', 'ads-links', '--agent', 'auto-links', '--stage', 'pipeline']);
  runCli(['register', '--issue', 'DD-2', ...base, '--id', 'ads-triage', '--agent', 'auto-triage', '--stage', 'bugfix']);
  runCli(['escalate', ...base, '--id', 'ads-triage', '--reason', 'write EPIPE twice']);

  let tail = 'Waiting for merge.';
  let seq = 7;
  const reads = [];
  const fakeRunner = (_session, args) => {
    if (args[1] === 'list') {
      const agent = { name: 'auto-links', pane_id: 'w1:p1', agent_status: 'idle', state_change_seq: seq };
      return JSON.stringify({ result: { agents: [agent] } });
    }
    if (args[1] === 'read') {
      reads.push(args[2]);
      return JSON.stringify({ result: { text: tail } });
    }
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  const poll = (...extra) => runCli(['poll', ...base, ...extra], fakeRunner).output;

  const first = poll();
  assert.equal(first.status, 'attention');
  assert.deepEqual(first.needs_attention.map((l) => l.id), ['ads-links']);
  assert.deepEqual(first.escalated.map((l) => l.id), ['ads-triage']);

  const second = poll();
  assert.equal(second.status, 'quiet');
  assert.deepEqual(second.needs_attention, []);
  assert.deepEqual(second.escalated, []);
  assert.deepEqual(second.unchanged.map((l) => l.id).sort(), ['ads-links', 'ads-triage']);
  assert.equal(reads.length, 1, 'unchanged lanes must not be read again');

  // 屏幕在动但状态没变（后台子代理的进度条），仍然不报。
  tail = 'worker running 43%';
  assert.equal(poll().status, 'quiet');

  // 状态序号一变就重新上报；--full 给换了上下文的总控补全量。
  tail = 'Merged. What next?';
  seq = 9;
  const third = poll();
  assert.equal(third.status, 'attention');
  assert.match(third.needs_attention[0].tail, /What next/);

  const full = poll('--full');
  assert.equal(full.status, 'attention');
  assert.deepEqual(full.unchanged, []);
  assert.equal(full.needs_attention.length, 1);
  assert.equal(full.escalated.length, 1);
});

test('poll keeps reporting a lane when Herdr gives no state_change_seq', () => {
  const ledgerPath = makeTempLedger();
  const base = ['--session', 'autopilot', '--ledger', ledgerPath];
  runCli(['register', '--issue', 'DD-1', ...base, '--id', 'feat-a', '--agent', 'auto-feat-a', '--stage', 'pipeline']);
  const fakeRunner = (_session, args) => (args[1] === 'list'
    ? JSON.stringify({ result: { agents: [{ name: 'auto-feat-a', pane_id: 'w1:p1', agent_status: 'idle' }] } })
    : JSON.stringify({ result: { text: 'Need input.' } }));

  runCli(['poll', ...base], fakeRunner);
  const second = runCli(['poll', ...base], fakeRunner).output;
  assert.equal(second.status, 'attention');
  assert.match(second.needs_attention[0].tail, /Need input/);
});

test('circuit breaker trips after max consecutive replies and escalates lane', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--issue', 'DD-1',
    '--session', 'autopilot',
    '--ledger', ledgerPath,
    '--id', 'bug-1',
    '--agent', 'auto-bug-1',
    '--stage', 'bugfix',
    '--max-replies', '2',
  ]);

  const r1 = runCli(['record-reply', '--session', 'autopilot', '--ledger', ledgerPath, '--id', 'bug-1', '--note', 'try 1']);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.output.allowed, true);
  assert.equal(r1.output.remaining, 1);

  const r2 = runCli(['record-reply', '--session', 'autopilot', '--ledger', ledgerPath, '--id', 'bug-1', '--note', 'try 2']);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.output.allowed, true);
  assert.equal(r2.output.remaining, 0);

  const r3 = runCli(['record-reply', '--session', 'autopilot', '--ledger', ledgerPath, '--id', 'bug-1', '--note', 'try 3']);
  assert.equal(r3.exitCode, 2);
  assert.equal(r3.output.allowed, false);
  assert.equal(r3.output.reason, 'circuit_breaker');

  // Escalated lane is reported under escalated, not needs_attention
  const pollRes = runCli(
    ['poll', '--session', 'autopilot', '--ledger', ledgerPath],
    () => JSON.stringify({ result: { agents: [{ name: 'auto-bug-1', pane_id: 'w1:p1', status: 'idle' }] } })
  );
  assert.equal(pollRes.output.needs_attention.length, 0);
  assert.equal(pollRes.output.escalated.length, 1);
  assert.match(pollRes.output.escalated[0].reason, /circuit_breaker/);

  // Human resolves -> counter resets and lane becomes active again
  const resolved = runCli(['resolve', '--session', 'autopilot', '--ledger', ledgerPath, '--id', 'bug-1']);
  assert.equal(resolved.exitCode, 0);
  assert.equal(resolved.output.status, 'active');
  assert.equal(resolved.output.consecutive_replies, 0);
});

test('set-stage advances stage and resets reply counter', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--issue', 'DD-1',
    '--session', 'autopilot',
    '--ledger', ledgerPath,
    '--id', 'feat-c',
    '--agent', 'auto-feat-c',
    '--stage', 'spec',
  ]);
  runCli(['record-reply', '--session', 'autopilot', '--ledger', ledgerPath, '--id', 'feat-c']);
  const advanced = runCli([
    'set-stage',
    '--session', 'autopilot',
    '--ledger', ledgerPath,
    '--id', 'feat-c',
    '--stage', 'awaiting_merge',
  ]);
  assert.equal(advanced.exitCode, 0);
  assert.equal(advanced.output.stage, 'awaiting_merge');
  assert.equal(advanced.output.status, 'awaiting_merge');
  assert.equal(advanced.output.consecutive_replies, 0);
});

test('poll reads real Herdr agent_status field for working and idle lanes', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--issue', 'DD-1',
    '--session', 'autopilot',
    '--ledger', ledgerPath,
    '--id', 'triage',
    '--agent', 'ads-triage',
    '--stage', 'spec',
  ]);
  runCli([
    'register',
    '--issue', 'DD-1',
    '--session', 'autopilot',
    '--ledger', ledgerPath,
    '--id', 'ready',
    '--agent', 'ads-ready',
    '--stage', 'pipeline',
  ]);

  const fakeRunner = (_session, args) => {
    if (args[0] === 'agent' && args[1] === 'list') {
      return JSON.stringify({
        result: {
          agents: [
            { name: 'ads-triage', pane_id: 'w2:p1', agent_status: 'idle' },
            { name: 'ads-ready', pane_id: 'w3:p1', agent_status: 'working' },
          ],
        },
      });
    }
    if (args[0] === 'agent' && args[1] === 'read' && args[2] === 'ads-triage') {
      return JSON.stringify({ result: { text: 'Triage complete.' } });
    }
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };

  const res = runCli(['poll', '--session', 'autopilot', '--ledger', ledgerPath], fakeRunner);
  assert.equal(res.exitCode, 0);
  assert.equal(res.output.working.length, 1);
  assert.equal(res.output.working[0].id, 'ready');
  assert.equal(res.output.working[0].state, 'working');
  assert.equal(res.output.needs_attention.length, 1);
  assert.equal(res.output.needs_attention[0].id, 'triage');
  assert.equal(res.output.needs_attention[0].state, 'idle');
  assert.equal(res.output.needs_attention[0].tail, 'Triage complete.');
});

test('register enforces compact visual naming on workspace, tab, and pane', () => {
  const calls = [];
  const runner = (session, args) => {
    assert.equal(session, 'default');
    calls.push(args);
    if (args[0] === 'pane' && args[1] === 'get') {
      return JSON.stringify({ result: { pane: { workspace_id: 'wA1', pane_id: 'wA1:p1', tab_id: 'wA1:t1' } } });
    }
    return '';
  };
  const ledger = makeTempLedger();
  launched(ledger, 'wA1:p1', 'jb548');
  // Reject missing label or bare ASCII slug without Chinese short name.
  assert.throws(
    () => runCli(['register', '--issue', 'JB-548', '--ledger', ledger, '--id', 'jb548', '--stage', 'spec', '--agent', 'jb548', '--workspace', 'wA1', '--pane', 'wA1:p1'], runner),
    /缺少可视化命名/
  );
  assert.throws(
    () => runCli(['register', '--issue', 'JB-548', '--ledger', ledger, '--id', 'jb548', '--stage', 'spec', '--agent', 'jb548', '--workspace', 'wA1', '--pane', 'wA1:p1', '--label', 'jb548-worker'], runner),
    /缺少中文简写/
  );
  // workspace 命名归 place，register 拒收 --workspace-label。
  assert.throws(
    () => runCli(['register', '--issue', 'JB-548', '--ledger', ledger, '--id', 'jb548', '--stage', 'spec', '--agent', 'jb548', '--workspace', 'wA1', '--pane', 'wA1:p1', '--label', '扩表Job', '--workspace-label', 'JB-512 零停机 M3'], runner),
    /workspace 由 place 按 Epic 命名/
  );
  // Valid compact visual label auto-prepends issue key and renames tab and pane.
  runCli([
    'register', '--issue', 'JB-548', '--ledger', ledger, '--id', 'jb548', '--stage', 'spec',
    '--agent', 'jb548', '--workspace', 'wA1', '--pane', 'wA1:p1', '--epic', 'JB-512',
    '--label', '扩表Job',
  ], runner);
  assert.deepEqual(calls.slice(-2), [
    ['tab', 'rename', 'wA1:t1', 'JB-548 扩表Job'],
    ['pane', 'rename', 'wA1:p1', 'JB-548 扩表Job'],
  ]);
});

test('done keeps unmerged and dirty trees, then retires Git before closing the pane', () => {
  const { execFileSync } = require('node:child_process');
  const ledger = makeTempLedger();
  const repo = fs.realpathSync(path.dirname(ledger));
  const tree = path.join(repo, 'feature');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=test',
    '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  git(repo, 'init', '-b', 'main');
  git(repo, 'commit', '--allow-empty', '-m', 'base');
  git(repo, 'worktree', 'add', '-b', 'feature', tree);
  git(tree, 'commit', '--allow-empty', '-m', 'feature');
  const pane = { pane_id: 'p1', tab_id: 't1', terminal_id: 'term', agent_status: 'done', cwd: tree };
  let attempts = 0;
  function runner(session, args) {
    switch (args.slice(0, 2).join(' ')) {
      case 'pane get': return JSON.stringify({ result: { pane } });
      case 'tab rename': return '';
      case 'pane rename': return '';
      case 'pane list': return JSON.stringify({ result: { panes: [pane] } });
      case 'agent list': return JSON.stringify({ result: { agents: [{ name: 'fix', pane_id: 'p1' }] } });
      case 'pane close':
        assert.equal(fs.existsSync(tree), false);
        assert.equal(git(repo, 'branch', '--list', 'feature').length, 0);
        if (++attempts === 1) throw new Error('close failed');
        return '';
      default: throw new Error('unexpected command');
    }
  }
  const cli = (cmd, ...args) => runCli([cmd, '--ledger', ledger, '--id', 'fix', ...args], runner);
  launched(ledger, 'p1', 'fix', ['--stage', 'bugfix', '--task', 'backend']);
  cli('register', '--issue', 'DD-1', '--agent', 'fix', '--stage', 'bugfix', '--repo', repo, '--worktree', tree,
    '--base', 'main', '--pane', 'p1', '--label', '修复回归');
  const done = () => cli('set-stage', '--stage', 'done');
  assert.throws(done, /merge-base/);
  git(repo, 'merge', '--ff-only', 'feature');
  fs.writeFileSync(path.join(tree, 'draft'), 'work');
  assert.throws(done, /工作树有未清理文件/);
  assert.equal(attempts, 0);
  fs.unlinkSync(path.join(tree, 'draft'));
  assert.throws(done, /close failed/);
  assert.equal(cli('list').output.lanes[0].escalated_reason, 'close failed');
  assert.equal(done().output.status, 'done');
  done();
  assert.equal(attempts, 2);
});

test('pane-only closeout checks terminal identity and keeps legacy lanes intact', () => {
  const ledger = makeTempLedger();
  const pane = { pane_id: 'p1', terminal_id: 'one', tab_id: 't1', agent_status: 'idle' };
  const calls = [];
  function runner(session, args) {
    calls.push(args.join(' '));
    return JSON.stringify({ result: { pane, panes: [pane], agents: [{ name: 'reader', pane_id: 'p1' }] } });
  }
  const cli = (cmd, id, ...args) => runCli([cmd, '--ledger', ledger, '--id', id, ...args], runner);
  cli('register', 'old', '--issue', 'DD-1', '--agent', 'legacy', '--stage', 'spec');
  assert.throws(() => cli('set-stage', 'old', '--stage', 'done'), /缺少登记/);
  launched(ledger, 'p1', 'reader');
  cli('register', 'read', '--issue', 'DD-1', '--agent', 'reader', '--stage', 'spec', '--pane', 'p1', '--pane-only', '--label', '只读核对');
  pane.terminal_id = 'two';
  assert.throws(() => cli('set-stage', 'read', '--stage', 'done'), /身份/);
  assert.equal(calls.includes('pane close p1'), false);
  pane.terminal_id = 'one';
  cli('set-stage', 'read', '--stage', 'done');
  assert.equal(calls.at(-1), 'pane close p1');
});

// 期望值来源：用户纠正“调度完找不到智能体工作的痕迹”；lane 必须能按所服务的 issue 找回。
test('register 必须登记所服务的 issue；poll 各栏带出 issue', () => {
  const ledgerPath = makeTempLedger();
  const register = (...extra) => runCli(['register', '--ledger', ledgerPath, '--stage', 'spec', ...extra]);
  assert.throws(() => register('--id', 'orphan', '--agent', 'orphan'), /--issue/);
  assert.throws(() => register('--id', 'orphan', '--agent', 'orphan', '--issue', 'JB 512'), /--issue/);
  register('--id', 'm3', '--agent', 'm3', '--issue', 'JB-512');
  register('--id', 'm4', '--agent', 'm4', '--issue', 'https://linear.app/erplus/issue/JB-515/spec');
  runCli(['escalate', '--ledger', ledgerPath, '--id', 'm4', '--reason', '缺权限']);
  const agents = [{ name: 'm3', pane_id: 'p1', agent_status: 'working' }];
  const res = runCli(['poll', '--ledger', ledgerPath], () => JSON.stringify({ result: { agents } }));
  assert.deepEqual(res.output.working.map((lane) => lane.issue), ['JB-512']);
  assert.deepEqual(res.output.escalated.map((lane) => lane.issue), ['https://linear.app/erplus/issue/JB-515/spec']);
});

// 期望值来源：用户纠正“只靠 4–5 分钟定时巡检导致等回复延迟与空转”；
// ─── 哨兵：代码巡检，变化才唤醒 ───────────────────────────────────────────────
// 现场：2026-11-24/25 四个总控会话被定时任务唤醒 178 次，每次约 57 万输入 token，
// 其中 70 次总控什么都没说。没有变化的巡检不该进模型。

function liveAgents(agents) {
  return (_session, args) => {
    if (args[1] === 'list') return JSON.stringify({ result: { agents: agents() } });
    if (args[1] === 'read') return JSON.stringify({ result: { text: `tail of ${args[2]}` } });
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
}

function editLedger(ledgerPath, edit) {
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  edit(ledger.lanes);
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
}

test('watch subscribes a lane with its current state as baseline and keeps one sentinel per thread', () => {
  const ledgerPath = makeTempLedger();
  const base = ['--ledger', ledgerPath];
  runCli(['register', '--issue', 'JB-1', ...base, '--id', 'a', '--agent', 'auto-a', '--stage', 'pipeline']);
  runCli(['register', '--issue', 'JB-2', ...base, '--id', 'b', '--agent', 'auto-b', '--stage', 'pipeline']);
  const runner = liveAgents(() => [
    { name: 'auto-a', agent_status: 'idle', state_change_seq: 5 },
    { name: 'auto-b', agent_status: 'working', state_change_seq: 8 },
  ]);
  const spawned = [];
  const spawner = (_script, cliArgs) => { spawned.push(cliArgs); return { pid: process.pid }; };
  const watch = (id, thread) => runCli(['watch', ...base, '--id', id, '--thread', thread], runner, { spawner }).output;

  const first = watch('a', 'thread-1');
  assert.equal(first.watching, true);
  assert.equal(first.baseline, 'idle@5');
  assert.equal(first.sentinel.already_running, false);
  assert.deepEqual(spawned[0].slice(0, 1), ['sentinel']);
  assert.ok(spawned[0].includes('thread-1'));

  const second = watch('b', 'thread-1');
  assert.equal(second.baseline, null, 'a working lane has nothing to remember yet');
  assert.equal(second.sentinel.already_running, true);
  assert.equal(spawned.length, 1, 'one sentinel per thread, not one per lane');

  const lanes = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).lanes;
  assert.equal(lanes.a.wake_thread, 'thread-1');
  assert.equal(lanes.a.woken_sig, 'idle@5');
});

// 现场：default.watch.jb348-carousel.log 第一行。watcher 等到终态才发现缺 T3 环境，那次唤醒丢了。
test('watch refuses to subscribe when it could never wake the thread or tell a change', () => {
  const ledgerPath = makeTempLedger();
  const base = ['--ledger', ledgerPath];
  runCli(['register', '--issue', 'JB-348', ...base, '--id', 'carousel', '--agent', 'carousel', '--stage', 'pipeline']);
  let spawns = 0;
  const spawner = () => { spawns += 1; return { pid: process.pid }; };
  const idle = liveAgents(() => [{ name: 'carousel', agent_status: 'idle', state_change_seq: 1 }]);
  const argv = ['watch', ...base, '--id', 'carousel', '--thread', 'thread-123'];

  assert.throws(() => runCli(argv, idle, { env: {}, spawner }), /missing T3 ACP MCP environment/);
  assert.throws(() => runCli(['watch', ...base, '--id', 'carousel'], idle, { spawner }), /requires --thread/);
  assert.throws(() => runCli(argv, liveAgents(() => []), { spawner }), /不在 Herdr/);
  const noSeq = liveAgents(() => [{ name: 'carousel', agent_status: 'idle' }]);
  assert.throws(() => runCli(argv, noSeq, { spawner }), /state_change_seq/);
  runCli(['escalate', ...base, '--id', 'carousel', '--reason', 'needs human']);
  assert.throws(() => runCli(argv, idle, { spawner }), /not active/);

  assert.equal(spawns, 0, 'no sentinel may be left running for a subscription that failed');
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).lanes.carousel.wake_thread, undefined);
});

test('sentinel poll reports only changes after subscription, only for its thread, and another poll cannot eat them', () => {
  const ledgerPath = makeTempLedger();
  const base = ['--ledger', ledgerPath];
  runCli(['register', '--issue', 'JB-1', ...base, '--id', 'a', '--agent', 'auto-a', '--stage', 'pipeline']);
  runCli(['register', '--issue', 'JB-2', ...base, '--id', 'b', '--agent', 'auto-b', '--stage', 'pipeline']);
  const seq = { a: 5, b: 3 };
  let agents = () => [
    { name: 'auto-a', agent_status: 'idle', state_change_seq: seq.a },
    { name: 'auto-b', agent_status: 'idle', state_change_seq: seq.b },
  ];
  const runner = (...args) => liveAgents(agents)(...args);
  const spawner = () => ({ pid: process.pid });
  runCli(['watch', ...base, '--id', 'a', '--thread', 't1'], runner, { spawner });
  runCli(['watch', ...base, '--id', 'b', '--thread', 't2'], runner, { spawner });
  const tick = (thread) => runCli(['poll', ...base, '--thread', thread], runner).output;
  const manual = () => runCli(['poll', ...base], runner, { sentinelAlive: () => true }).output;

  // 订阅时的状态总控已经知道：不唤醒。
  const quiet = tick('t1');
  assert.equal(quiet.status, 'quiet');
  assert.equal(quiet.watching, 1);

  // 共用账本的另一个总控先 poll 到了变化，t1 的哨兵照样要报。
  seq.a = 7;
  assert.deepEqual(manual().needs_attention.map((l) => l.id).sort(), ['a', 'b']);
  const changed = tick('t1');
  assert.equal(changed.status, 'attention');
  assert.deepEqual(changed.needs_attention.map((l) => l.id), ['a'], 'lane b belongs to another thread');
  assert.match(changed.needs_attention[0].tail, /tail of auto-a/);
  assert.equal(tick('t1').status, 'quiet', 'the same state wakes once');

  // 哨兵报过的，总控手动 poll 不再重报。
  seq.a = 9;
  assert.equal(tick('t1').status, 'attention');
  assert.deepEqual(manual().unchanged.map((l) => l.id).sort(), ['a', 'b']);

  // agent 消失也是变化；回到 working 后再消失要再报。
  const all = agents;
  agents = () => [];
  assert.deepEqual(tick('t1').missing.map((l) => l.id), ['a']);
  assert.equal(tick('t1').status, 'quiet');
  agents = () => all().map((agent) => ({ ...agent, agent_status: 'working' }));
  assert.equal(tick('t1').status, 'quiet');
  agents = () => [];
  assert.deepEqual(tick('t1').missing.map((l) => l.id), ['a']);

  // 等人的 lane 不归哨兵报，但哨兵要留着等它恢复；全部 done 才没有可看的。
  runCli(['escalate', ...base, '--id', 'a', '--reason', 'needs human']);
  const parked = tick('t1');
  assert.equal(parked.status, 'quiet');
  assert.equal(parked.watching, 1);
  editLedger(ledgerPath, (lanes) => { lanes.a.status = 'done'; lanes.a.stage = 'done'; });
  assert.equal(tick('t1').watching, 0);

  // 读不到状态序号就分不清变没变：失败，不能每拍都唤醒。
  agents = () => [{ name: 'auto-b', agent_status: 'idle' }];
  assert.throws(() => tick('t2'), /state_change_seq/);
});

test('sentinel loop stays silent on unchanged ticks, wakes with the poll result inline, and exits when nothing is watched', () => {
  const lane = { id: 'a', issue: 'JB-1', agent: 'auto-a', stage: 'pipeline', state: 'idle', tail: 'Merged. What next?' };
  const ticks = [
    { status: 'quiet', watching: 1, needs_attention: [], missing: [] },
    { status: 'quiet', watching: 1, needs_attention: [], missing: [] },
    { status: 'attention', watching: 1, needs_attention: [lane], missing: [] },
    { status: 'quiet', watching: 0, needs_attention: [], missing: [] },
  ];
  const wakes = [];
  let sleeps = 0;
  const result = runSentinel({
    threadId: 't1',
    poll: () => ticks.shift(),
    wake: (payload) => wakes.push(payload),
    notify: () => assert.fail('nothing went wrong'),
    sleep: () => { sleeps += 1; },
  });

  assert.deepEqual(result, { exit: 0, reason: 'nothing_watched' });
  assert.equal(sleeps, 3);
  assert.equal(wakes.length, 1, 'two unchanged ticks reach no model');
  assert.equal(wakes[0].threadId, 't1');
  assert.ok(wakes[0].message.startsWith('[herdr-autopilot WAKE]'), 'orchestration_metrics 靠这个前缀认事件唤醒');
  assert.match(wakes[0].message, /Merged\. What next\?/);
  assert.match(wakes[0].message, /不用再跑 poll/);
  assert.doesNotMatch(wakes[0].message, /\$herdr-autopilot|\/herdr-autopilot/, 'a wake must not re-inject the skill body');
});

test('sentinel tells the human when it cannot wake the thread, and gives up after three failed polls', () => {
  const attention = { status: 'attention', watching: 1, needs_attention: [{ id: 'a' }], missing: [] };
  const notes = [];
  const ticks = [attention, { status: 'quiet', watching: 0 }];
  const lost = runSentinel({
    threadId: 't1',
    poll: () => ticks.shift(),
    wake: () => { throw new Error('401 unauthorized'); },
    notify: (text) => notes.push(text),
    sleep: () => {},
  });
  assert.equal(lost.exit, 0, 'a failed wake does not stop the sentinel');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /401 unauthorized/);

  notes.length = 0;
  const flaky = [new Error('lock busy'), new Error('lock busy'), { status: 'quiet', watching: 1 },
    new Error('herdr down'), new Error('herdr down'), new Error('herdr down')];
  const dead = runSentinel({
    threadId: 't1',
    poll: () => { const next = flaky.shift(); if (next instanceof Error) throw next; return next; },
    wake: () => assert.fail('nothing to wake for'),
    notify: (text) => notes.push(text),
    sleep: () => {},
  });
  assert.equal(dead.exit, 1);
  assert.equal(flaky.length, 0, 'two failures followed by a good poll do not count toward the limit');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /herdr down/);
});

test('poll flags subscribed lanes whose sentinel died as unwatched', () => {
  const ledgerPath = makeTempLedger();
  const base = ['--ledger', ledgerPath];
  runCli(['register', '--issue', 'JB-1', ...base, '--id', 'a', '--agent', 'auto-a', '--stage', 'pipeline']);
  runCli(['register', '--issue', 'JB-2', ...base, '--id', 'b', '--agent', 'auto-b', '--stage', 'pipeline']);
  const runner = liveAgents(() => [
    { name: 'auto-a', agent_status: 'working', state_change_seq: 5 },
    { name: 'auto-b', agent_status: 'working', state_change_seq: 6 },
  ]);
  runCli(['watch', ...base, '--id', 'a', '--thread', 't1'], runner, { spawner: () => ({ pid: process.pid }) });
  const asked = [];
  const poll = (alive) => runCli(['poll', ...base], runner, { sentinelAlive: (t) => { asked.push(t); return alive; } }).output;

  const healthy = poll(true);
  assert.equal(healthy.status, 'quiet');
  assert.deepEqual(healthy.unwatched, []);

  const orphaned = poll(false);
  assert.equal(orphaned.status, 'attention');
  assert.deepEqual(orphaned.unwatched.map((l) => [l.id, l.thread]), [['a', 't1']]);
  assert.deepEqual([...new Set(asked)], ['t1'], 'lanes nobody subscribed to are not flagged');
});

// 期望值来源：用户纠正 e9bf46be-d564-4ec6-b871-31f573a5970a 调度期间 JB-512/JB-542/JB-548 全程留在 Backlog；
// register 必须把直接 issue 与未开始父链置为 In Progress 并回读，awaiting_merge 推至 In Review，done 仅关闭直接 issue。
test('Linear issue sync promotes ticket and unstarted parents on register, moves to In Review and Done with readback', () => {
  const statuses = [
    { id: 'st-backlog', type: 'backlog', name: 'Backlog' },
    { id: 'st-todo', type: 'unstarted', name: 'Todo' },
    { id: 'st-progress', type: 'started', name: 'In Progress' },
    { id: 'st-review', type: 'started', name: 'In Review' },
    { id: 'st-done', type: 'completed', name: 'Done' },
    { id: 'st-canceled', type: 'canceled', name: 'Canceled' },
  ];
  const db = {
    'JB-512': { id: 'JB-512', status: 'Backlog', statusType: 'backlog', teamId: 'team-jb', parentId: null },
    'JB-542': { id: 'JB-542', status: 'Backlog', statusType: 'backlog', teamId: 'team-jb', parentId: 'JB-512' },
    'JB-548': { id: 'JB-548', status: 'Backlog', statusType: 'backlog', teamId: 'team-jb', parentId: 'JB-542' },
  };
  const mutations = [];
  const callLinear = (tool, args) => {
    if (tool === 'get_issue') return { ...db[args.id] };
    if (tool === 'list_issue_statuses') return statuses;
    if (tool === 'save_issue') {
      mutations.push(args);
      const next = statuses.find((s) => s.id === args.state || s.name === args.state);
      db[args.id].status = next.name;
      db[args.id].statusType = next.type;
      return { id: args.id };
    }
    throw new Error(`unexpected tool ${tool}`);
  };
  const realSync = (issue, target) => syncIssueState(issue, target, { callLinear });

  const ledgerPath = makeTempLedger();
  const reg = rawRunCli(
    ['register', '--ledger', ledgerPath, '--id', 'jb548', '--issue', 'https://linear.app/erplus/issue/JB-548/demo', '--agent', 'jb548', '--stage', 'pipeline'],
    undefined,
    { issueSync: realSync }
  );
  assert.equal(reg.exitCode, 0);
  assert.equal(reg.output.issue_state, 'In Progress');
  assert.equal(db['JB-548'].status, 'In Progress');
  assert.equal(db['JB-542'].status, 'In Progress');
  assert.equal(db['JB-512'].status, 'In Progress');

  // Re-running sync-issue --target started is idempotent (zero mutations).
  const beforeCount = mutations.length;
  const noop = rawRunCli(['sync-issue', '--issue', 'JB-548', '--target', 'started'], undefined, { issueSync: realSync });
  assert.equal(noop.output.changed, false);
  assert.equal(mutations.length, beforeCount);

  // Poll surfaces synced issue_state.
  const poll = rawRunCli(
    ['poll', '--ledger', ledgerPath],
    () => JSON.stringify({ result: { agents: [{ name: 'jb548', pane_id: 'p1', agent_status: 'working' }] } }),
    { issueSync: realSync }
  );
  assert.equal(poll.output.working[0].issue_state, 'In Progress');

  // awaiting_merge moves direct issue to In Review; parents stay In Progress.
  const review = rawRunCli(
    ['set-stage', '--ledger', ledgerPath, '--id', 'jb548', '--stage', 'awaiting_merge'],
    undefined,
    { issueSync: realSync }
  );
  assert.equal(review.output.issue_state, 'In Review');
  assert.equal(db['JB-548'].status, 'In Review');
  assert.equal(db['JB-542'].status, 'In Progress');

  // sync-issue --target done closes only JB-548, never parent Spec/Epic.
  const closed = rawRunCli(['sync-issue', '--issue', 'JB-548', '--target', 'done'], undefined, { issueSync: realSync });
  assert.equal(closed.output.state, 'Done');
  assert.equal(db['JB-548'].status, 'Done');
  assert.equal(db['JB-542'].status, 'In Progress');
  assert.equal(db['JB-512'].status, 'In Progress');
});

// 期望值来源：$correct 证明旧错误会失败——若 issue 写入后回读仍留在 Backlog，register 与 set-stage --stage done 必须 fail-close。
test('register and set-stage done fail-close when issue readback remains Backlog, and done retry is idempotent', () => {
  const { execFileSync } = require('node:child_process');
  const statuses = [
    { id: 'st-backlog', type: 'backlog', name: 'Backlog' },
    { id: 'st-progress', type: 'started', name: 'In Progress' },
    { id: 'st-review', type: 'started', name: 'In Review' },
    { id: 'st-done', type: 'completed', name: 'Done' },
  ];
  let dropWrites = true;
  const issue = { id: 'JB-548', status: 'Backlog', statusType: 'backlog', teamId: 'team-jb', parentId: null };
  const callLinear = (tool, args) => {
    if (tool === 'get_issue') return { ...issue };
    if (tool === 'list_issue_statuses') return statuses;
    if (tool === 'save_issue') {
      if (!dropWrites) {
        const next = statuses.find((s) => s.id === args.state || s.name === args.state);
        issue.status = next.name;
        issue.statusType = next.type;
      }
      return { id: args.id };
    }
    throw new Error(`unexpected tool ${tool}`);
  };
  const realSync = (raw, target) => syncIssueState(raw, target, { callLinear });

  // 1) Old error on register: issue stays Backlog -> register fails and writes nothing to ledger.
  const ledger = makeTempLedger();
  assert.throws(
    () => rawRunCli(['register', '--ledger', ledger, '--id', 'jb548', '--issue', 'JB-548', '--agent', 'jb548', '--stage', 'pipeline'], undefined, { issueSync: realSync }),
    /状态回读校验失败/
  );
  assert.equal(rawRunCli(['list', '--ledger', ledger]).output.lanes.length, 0);

  // 2) Normal register with real worktree + pane, then simulate failure on done.
  dropWrites = false;
  const repo = fs.realpathSync(path.dirname(ledger));
  const tree = path.join(repo, 'jb548-tree');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=test',
    '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  git(repo, 'init', '-b', 'main');
  git(repo, 'commit', '--allow-empty', '-m', 'base');
  git(repo, 'worktree', 'add', '-b', 'jb548-branch', tree);
  git(tree, 'commit', '--allow-empty', '-m', 'work');
  git(repo, 'merge', '--ff-only', 'jb548-branch');

  const pane = { pane_id: 'p1', tab_id: 't1', terminal_id: 'term', agent_status: 'done', cwd: tree };
  let closeCalls = 0;
  const runner = (_session, args) => {
    const key = args.slice(0, 2).join(' ');
    if (key === 'pane get') return JSON.stringify({ result: { pane } });
    if (key === 'tab rename' || key === 'pane rename') return '';
    if (key === 'pane list') return JSON.stringify({ result: { panes: closeCalls ? [] : [pane] } });
    if (key === 'agent list') return JSON.stringify({ result: { agents: [{ name: 'jb548', pane_id: 'p1' }] } });
    if (key === 'pane close') { closeCalls += 1; return ''; }
    throw new Error(`unexpected ${key}`);
  };
  launched(ledger, 'p1', 'jb548', ['--stage', 'pipeline']);
  rawRunCli(
    ['register', '--ledger', ledger, '--id', 'jb548', '--issue', 'JB-548', '--agent', 'jb548', '--stage', 'pipeline', '--repo', repo, '--worktree', tree, '--base', 'main', '--pane', 'p1', '--label', '扩表Job'],
    runner,
    { issueSync: realSync }
  );
  assert.equal(issue.status, 'In Progress');

  // Old error on done: write silently dropped -> done fails-close and escalates lane.
  dropWrites = true;
  assert.throws(
    () => rawRunCli(['set-stage', '--ledger', ledger, '--id', 'jb548', '--stage', 'done'], runner, { issueSync: realSync }),
    /状态回读校验失败/
  );
  const escalated = rawRunCli(['list', '--ledger', ledger]).output.lanes[0];
  assert.equal(escalated.status, 'escalated');
  assert.match(escalated.escalated_reason, /状态回读校验失败/);

  // Retry once Linear recovers: closeout is idempotent (no second pane close), issue transitions to Done.
  dropWrites = false;
  const finished = rawRunCli(['set-stage', '--ledger', ledger, '--id', 'jb548', '--stage', 'done'], runner, { issueSync: realSync });
  assert.equal(finished.output.status, 'done');
  assert.equal(finished.output.issue_state, 'Done');
  assert.equal(issue.status, 'Done');
  assert.equal(closeCalls, 1);
});

test('keep-issue-open requires reason, pane-only skips auto-close, terminal issues reject register, and GitHub URLs sync', () => {
  assert.deepEqual(parseIssueRef('https://github.com/Dimon94/skills/issues/42'), {
    tracker: 'github',
    repo: 'Dimon94/skills',
    number: '42',
  });

  // Terminal issue rejects register.
  const doneIssue = { id: 'JB-999', status: 'Done', statusType: 'completed', teamId: 't1', parentId: null };
  assert.throws(
    () => syncIssueState('JB-999', 'started', {
      callLinear: (tool) => (tool === 'get_issue' ? doneIssue : [{ id: 's1', type: 'started', name: 'In Progress' }]),
    }),
    /已处于终态/
  );

  // pane-only lane skips auto-closing issue on done; --keep-issue-open requires --reason and keeps issue at In Review.
  const ledger = makeTempLedger();
  const panes = [
    { pane_id: 'p1', terminal_id: 't1', tab_id: 'tab1', agent_status: 'idle' },
    { pane_id: 'p2', terminal_id: 't2', tab_id: 'tab2', agent_status: 'idle' },
  ];
  const agents = [
    { name: 'r1', pane_id: 'p1' },
    { name: 'r2', pane_id: 'p2' },
  ];
  const runner = (_session, args) => {
    const pane = args[0] === 'pane' && args[1] === 'get' ? panes.find((p) => p.pane_id === args[2]) : panes[0];
    return JSON.stringify({ result: { pane, panes, agents } });
  };
  const targets = [];
  const spySync = (issue, target) => {
    targets.push([issue, target]);
    return stubIssueSync(issue, target);
  };
  launched(ledger, 'p1', 'r1');
  rawRunCli(['register', '--ledger', ledger, '--id', 'ro', '--issue', 'JB-512', '--agent', 'r1', '--stage', 'spec', '--pane', 'p1', '--pane-only', '--label', '巡检只读'], runner, { issueSync: spySync });
  rawRunCli(['set-stage', '--ledger', ledger, '--id', 'ro', '--stage', 'done'], runner, { issueSync: spySync });
  assert.deepEqual(targets, [['JB-512', 'started']]);

  launched(ledger, 'p2', 'r2');
  rawRunCli(['register', '--ledger', ledger, '--id', 'w1', '--issue', 'JB-513', '--agent', 'r2', '--stage', 'spec', '--pane', 'p2', '--pane-only', '--label', '留门验收'], runner, { issueSync: spySync });
  assert.throws(
    () => rawRunCli(['set-stage', '--ledger', ledger, '--id', 'w1', '--stage', 'done', '--keep-issue-open'], runner, { issueSync: spySync }),
    /--reason/
  );
  const kept = rawRunCli(
    ['set-stage', '--ledger', ledger, '--id', 'w1', '--stage', 'done', '--keep-issue-open', '--reason', '等待生产发布验收'],
    runner,
    { issueSync: spySync }
  );
  assert.equal(kept.output.status, 'done');
  assert.equal(kept.output.issue_state, 'In Review');
  assert.equal(kept.output.issue_kept_open_reason, '等待生产发布验收');

  // GitHub issue close + readback.
  let ghState = 'OPEN';
  const ghRes = syncIssueState('https://github.com/Dimon94/skills/issues/42', 'done', {
    runGh: (args) => {
      if (args[1] === 'view') return JSON.stringify({ state: ghState });
      if (args[1] === 'close') { ghState = 'CLOSED'; return ''; }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
  });
  assert.equal(ghRes.state, 'CLOSED');
  assert.equal(ghRes.changed, true);
});

// 期望值来源：用户纠正 Herdr 调度未按 2x2 四格落位、未按“中文简写+英文+issue号”命名 workspace/tab/pane。
test('place enforces 2x2 four-quadrant grid, overflows to -2 tab on 5th pane, and validates CJK display width', () => {
  assert.equal(displayWidth('JB-512 零停机 M3'), 16);
  assert.throws(
    () => formatVisualLabel({ issue: 'JB-512', label: '生产分层零停机发布体系全量方案', maxCols: 20, kind: 'workspace' }),
    /显示宽度.*超过上限 20/
  );

  const tabs = [{ tab_id: 'w1:t0', label: 'JB-512 零停机 M3', pane_count: 1 }];
  const panes = [{ pane_id: 'w1:p0', tab_id: 'w1:t0', workspace_id: 'w1' }];
  const calls = [];
  let nextTab = 1;
  let nextPane = 1;

  const runner = (_session, args) => {
    calls.push(args);
    const cmd = args.slice(0, 2).join(' ');
    if (cmd === 'workspace rename' || cmd === 'pane rename') return '';
    if (cmd === 'tab list') return JSON.stringify({ result: { tabs } });
    if (cmd === 'workspace list') return JSON.stringify({ result: { workspaces: [{ workspace_id: 'w1', label: 'JB-512 零停机' }] } });
    if (cmd === 'pane list') return JSON.stringify({ result: { panes } });
    if (cmd === 'tab create') {
      const label = args[args.indexOf('--label') + 1];
      const tabId = `w1:t${nextTab++}`;
      const paneId = `w1:p${nextPane++}`;
      tabs.push({ tab_id: tabId, label, pane_count: 1 });
      panes.push({ pane_id: paneId, tab_id: tabId, workspace_id: 'w1' });
      return JSON.stringify({ result: { pane_id: paneId, tab_id: tabId, workspace_id: 'w1' } });
    }
    if (cmd === 'pane split') {
      const anchorId = args[args.indexOf('--pane') + 1];
      const anchor = panes.find((p) => p.pane_id === anchorId);
      const paneId = `w1:p${nextPane++}`;
      panes.push({ pane_id: paneId, tab_id: anchor.tab_id, workspace_id: 'w1' });
      tabs.find((t) => t.tab_id === anchor.tab_id).pane_count += 1;
      return JSON.stringify({ result: { pane_id: paneId, tab_id: anchor.tab_id, workspace_id: 'w1' } });
    }
    if (cmd === 'pane get') {
      const p = panes.find((item) => item.pane_id === args[2]);
      return JSON.stringify({ result: { pane: p } });
    }
    throw new Error(`unexpected herdr ${args.join(' ')}`);
  };

  const placeOne = (issue, paneLabel, extra = []) => runCli([
    'place', '--epic', 'JB-512', '--cwd', '/tmp/wt', '--issue', issue,
    '--tab-prefix', 'JB-512 实施', '--pane-label', paneLabel, '--exclude-tab', 'w1:t0', ...extra,
  ], runner).output;

  const r1 = placeOne('JB-546', '双向门禁', ['--workspace-label', '零停机 M3']);
  const r2 = placeOne('JB-547', 'PG连接池');
  const r3 = placeOne('JB-548', '扩表Job');
  const r4 = placeOne('JB-549', '滚动引擎');
  const r5 = placeOne('JB-550', 'API切流');

  assert.equal(r1.tab_label, 'JB-512 实施');
  assert.equal(r1.workspace_label, 'JB-512 零停机 M3');
  assert.equal(r1.pane_label, 'JB-546 双向门禁');
  assert.equal(r2.tab_id, r1.tab_id);
  assert.equal(r3.tab_id, r1.tab_id);
  assert.equal(r4.tab_id, r1.tab_id);
  assert.equal(r4.pane_count, 4);
  assert.equal(r5.tab_label, 'JB-512 实施-2');
  assert.equal(r5.pane_count, 1);

  // Verify exact 2x2 split geometry: 2nd -> right(p1), 3rd -> down(p1), 4th -> down(p2).
  const splits = calls.filter((c) => c[0] === 'pane' && c[1] === 'split').map((c) => [
    c[c.indexOf('--pane') + 1],
    c[c.indexOf('--direction') + 1],
  ]);
  assert.deepEqual(splits, [
    ['w1:p1', 'right'],
    ['w1:p1', 'down'],
    ['w1:p2', 'down'],
  ]);
});

// 期望值来源：$correct 重放旧错误——计划配 claude/Opus 5.5，lane 却被手写 `herdr agent start --kind pi` 启动后直接登记。
test('launch starts planning lanes from model config and register rejects panes not launched that way', () => {
  const ledger = makeTempLedger();
  const runner = (_s, args) => (args[0] === 'pane' && args[1] === 'get'
    ? JSON.stringify({ result: { pane: { pane_id: 'p1', tab_id: 't1' } } }) : '');
  const register = (agent) => runCli(['register', '--ledger', ledger, '--id', 'jb574', '--issue', 'JB-574',
    '--agent', agent, '--stage', 'tickets', '--pane', 'p1', '--label', '分发拆票'], runner);

  // 旧错误：pane 不经 launch 启动，register 必须拒绝。
  assert.throws(() => register('jb574'), /不是经 launch 按模型配置启动的/);

  // tickets 属 planning：按配置启动 claude / Opus 5.5，不落到默认 pi。
  const res = launched(ledger, 'p1', 'jb574', ['--stage', 'tickets']);
  assert.deepEqual(res.calls, [['agent', 'start', 'jb574', '--kind', 'claude', '--pane', 'p1', '--', '--model', 'claude-opus-5-5']]);
  assert.equal(res.output.task, 'planning');

  assert.throws(() => register('other'), /与 --agent "other" 不符/);
  const lane = register('jb574').output;
  assert.deepEqual([lane.launch.kind, lane.launch.model, lane.launch.task], ['claude', 'claude-opus-5-5', 'planning']);
  // 记录只能消费一次：同一 pane 不能再登记第二条 lane。
  assert.throws(() => runCli(['register', '--ledger', ledger, '--id', 'again', '--issue', 'JB-574', '--agent', 'jb574',
    '--stage', 'tickets', '--pane', 'p1', '--label', '分发拆票'], runner), /不是经 launch/);
});

test('launch requires an explicit task type for bugfix and rejects non-start plans', () => {
  const ledger = makeTempLedger();
  assert.throws(() => launched(ledger, 'p1', 'fix', ['--stage', 'bugfix']), /需要显式 --task/);
  assert.throws(() => rawRunCli(['launch', '--ledger', ledger, '--pane', 'p1', '--agent', 'fix', '--stage', 'spec'],
    () => '', { planner: () => ({ argv: ['herdr', 'pane', 'close', 'p1'] }) }), /不是 herdr agent start/);
});

// 期望值来源：setup 合同（delivery-pipeline-setup SKILL.md 第 2 步）——probe 的 stdin 必须是网关清单原始来源。
// 旧错误：launch 传 '{}'，pi 经网关的模型全被丢弃，backend/testing lane 报 "pi model is absent from capability evidence"。
test('default planner hands the gateway catalog to probe, or status unknown when unreachable', () => {
  const { defaultPlanner } = require('../scripts/launch.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-probe-'));
  const seen = path.join(dir, 'stdin.json');
  const script = path.join(dir, 'model_config.py');
  fs.writeFileSync(script, [
    'import json, sys',
    `if sys.argv[1] == 'probe': open(${JSON.stringify(seen)}, 'w').write(sys.stdin.read()); print('{"capabilities": {}}')`,
    `elif sys.argv[1] == 'resolve': print('{"agent": "pi", "model": "m", "effort": "high"}')`,
    `else: print('["herdr", "agent", "start"]')`,
  ].join('\n'));
  const catalog = path.join(dir, 'models.json');
  fs.writeFileSync(catalog, JSON.stringify({ data: [{ id: 'auto/gpt-6.2-sol' }] }));
  const saved = { ...process.env };
  try {
    process.env.HERDR_AUTOPILOT_MODEL_CONFIG = script;
    process.env.HERDR_AUTOPILOT_GATEWAY_MODELS = `file://${catalog}`;
    defaultPlanner({ task: 'backend', workerName: 'w', paneId: 'p1' });
    assert.deepEqual(JSON.parse(fs.readFileSync(seen, 'utf8')),
      { gateway: { status: 'ok', data: [{ id: 'auto/gpt-6.2-sol' }] } });
    process.env.HERDR_AUTOPILOT_GATEWAY_MODELS = `file://${path.join(dir, 'missing.json')}`;
    defaultPlanner({ task: 'backend', workerName: 'w', paneId: 'p1' });
    assert.deepEqual(JSON.parse(fs.readFileSync(seen, 'utf8')), { gateway: { status: 'unknown' } });
  } finally {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 期望值来源：用户要求 /herdr-autopilot 一个 Epic 独占一个 workspace，两个 Epic 不共用同一 space。
test('one Epic owns one workspace: place and register reject cross-Epic sharing', () => {
  const ledger = makeTempLedger();
  const panes = { 'wA:p1': 'wA', 'wA:p2': 'wA', 'wB:p1': 'wB' };
  const runner = (session, args) => {
    if (args[0] === 'pane' && args[1] === 'get') {
      return JSON.stringify({ result: { pane: { workspace_id: panes[args[2]], pane_id: args[2], tab_id: `${panes[args[2]]}:t1` } } });
    }
    return '';
  };
  const reg = (id, pane, epic) => {
    launched(ledger, pane, id);
    return runCli(['register', '--ledger', ledger, '--id', id, '--issue', `JB-${id.slice(2)}`, '--epic', epic,
      '--stage', 'spec', '--agent', id, '--pane', pane, '--label', '扩表Job'], runner, { issueSync: () => ({}) });
  };
  assert.equal(reg('jb601', 'wA:p1', 'JB-600').output.epic, 'JB-600');
  // 同 Epic 同 space：允许
  reg('jb602', 'wA:p2', 'JB-600');
  // 另一 Epic 进同一 space：拒绝
  assert.throws(() => reg('jb701', 'wA:p2', 'JB-700'), /已由 Epic JB-600/);
  assert.throws(
    () => runCli(['place', '--ledger', ledger, '--workspace', 'wA', '--cwd', '/tmp', '--issue', 'JB-701', '--epic', 'JB-700',
      '--tab-prefix', '扩表', '--pane-label', '扩表Job'], runner),
    /place 不接受 --workspace/
  );
  // 同 Epic 分到第二个 space：拒绝
  assert.throws(() => reg('jb603', 'wB:p1', 'JB-600'), /已落在 workspace "wA"/);
  // 另一 Epic 独占新 space：允许
  assert.equal(reg('jb702', 'wB:p1', 'JB-700').output.workspace, 'wB');
});

// 期望值来源：同上；Epic 没有 workspace 时由 place 新建，已有时复用，agent 不选 workspace。
test('place resolves the Epic workspace: reuse by ledger or label, else create one', () => {
  const ledger = makeTempLedger();
  const calls = [];
  const workspaces = [{ workspace_id: 'wOld', label: 'JB-500 旧需求' }];
  const runner = (_session, args) => {
    calls.push(args);
    const cmd = args.slice(0, 2).join(' ');
    if (cmd === 'workspace list') return JSON.stringify({ result: { workspaces } });
    if (cmd === 'workspace create') {
      workspaces.push({ workspace_id: 'wNew', label: args[args.indexOf('--label') + 1] });
      return JSON.stringify({ result: { workspace: { workspace_id: 'wNew' }, tab: { tab_id: 'wNew:t1' }, root_pane: { pane_id: 'wNew:p1' } } });
    }
    if (cmd === 'pane get') return JSON.stringify({ result: { pane: { pane_id: args[2], tab_id: 'wNew:t1', workspace_id: 'wNew' } } });
    if (cmd === 'tab list') return JSON.stringify({ result: { tabs: [{ tab_id: 'wNew:t1', label: 'JB-600 实施', pane_count: 1 }] } });
    if (cmd === 'pane list') return JSON.stringify({ result: { panes: [{ pane_id: 'wNew:p1', tab_id: 'wNew:t1', workspace_id: 'wNew' }] } });
    if (cmd === 'pane split') return JSON.stringify({ result: { pane: { pane_id: 'wNew:p2' } } });
    return '';
  };
  const place = (issue, extra = []) => runCli(['place', '--ledger', ledger, '--epic', 'JB-600', '--cwd', '/tmp', '--issue', issue,
    '--tab-prefix', 'JB-600 实施', '--pane-label', '扩表Job', ...extra], runner).output;
  assert.throws(() => place('JB-601'), /需要 --workspace-label 来新建/);
  assert.throws(() => place('JB-601', ['--workspace-label', 'JB-512 零停机']), /须以所属 Epic 号 JB-600 开头/);
  const first = place('JB-601', ['--workspace-label', '分销']);
  assert.equal(first.workspace_id, 'wNew');
  assert.equal(first.pane_id, 'wNew:p1');
  assert.deepEqual(calls.find((c) => c[1] === 'create'), ['workspace', 'create', '--cwd', '/tmp', '--label', 'JB-600 分销', '--no-focus']);
  // 第二张票：凭 Epic 号认出 wNew，不再新建。
  const second = place('JB-602');
  assert.equal(second.workspace_id, 'wNew');
  assert.equal(calls.filter((c) => c[1] === 'create' && c[0] === 'workspace').length, 1);
});
