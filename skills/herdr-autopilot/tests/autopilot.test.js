'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateSession, runCli } = require('../scripts/autopilot.js');

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

test('register names the tab containing the enrolled pane', () => {
  for (const label of [undefined, '核对链接']) {
    let title = '1';
    const runner = (session, args) => {
      assert.equal(session, 'default');
      if (args[0] === 'pane') {
        assert.deepEqual(args, ['pane', 'get', 'wA1:p1']);
        return JSON.stringify({ result: { pane: { workspace_id: 'wA1', pane_id: 'wA1:p1', tab_id: 'wA1:t1' } } });
      }
      assert.deepEqual(args.slice(0, 3), ['tab', 'rename', 'wA1:t1']);
      title = args[3];
    };
    const args = ['register', '--issue', 'DD-1', '--ledger', makeTempLedger(), '--id', 'ads-links',
      '--stage', 'spec', '--agent', 'ads-links', '--workspace', 'wA1', '--pane', 'wA1:p1'];
    if (label) args.push('--label', label);
    runCli(args, runner);
    assert.equal(title, label || 'ads-links');
  }
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
  cli('register', '--issue', 'DD-1', '--agent', 'fix', '--stage', 'bugfix', '--repo', repo, '--worktree', tree,
    '--base', 'main', '--pane', 'p1');
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
  cli('register', 'read', '--issue', 'DD-1', '--agent', 'reader', '--stage', 'spec', '--pane', 'p1', '--pane-only');
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
// watch 必须用 herdr agent wait 阻塞等终态/阻断态并立刻唤醒主会话，且支持去重与防陈旧唤醒。
test('watch blocks on herdr agent wait and immediately wakes target thread on settled state', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--issue', 'JB-512',
    '--ledger', ledgerPath,
    '--id', 'jb512-m3',
    '--agent', 'jb512-m3',
    '--stage', 'pipeline',
  ]);

  const herdrCalls = [];
  const wakeCalls = [];
  const fakeRunner = (session, args) => {
    herdrCalls.push([session, ...args]);
    if (args[0] === 'agent' && args[1] === 'wait') return '';
    if (args[0] === 'agent' && args[1] === 'list') {
      return JSON.stringify({
        result: { agents: [{ name: 'jb512-m3', pane_id: 'wA5:p1', agent_status: 'blocked' }] },
      });
    }
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  const fakeWaker = (payload) => {
    wakeCalls.push(payload);
    return { ok: true };
  };

  const res = runCli(
    ['watch', '--ledger', ledgerPath, '--id', 'jb512-m3', '--thread', 'thread-123', '--after-prompt'],
    fakeRunner,
    { waker: fakeWaker }
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.output.woke, true);
  assert.equal(res.output.state, 'blocked');
  assert.equal(res.output.thread_id, 'thread-123');
  assert.deepEqual(herdrCalls[0], ['default', 'agent', 'wait', 'jb512-m3', '--until', 'working', '--timeout', '5000']);
  assert.deepEqual(herdrCalls[1], ['default', 'agent', 'wait', 'jb512-m3']);
  assert.equal(wakeCalls.length, 1);
  assert.equal(wakeCalls[0].threadId, 'thread-123');
  assert.match(wakeCalls[0].message, /jb512-m3/);
  assert.match(wakeCalls[0].message, /JB-512/);
  assert.match(wakeCalls[0].message, /blocked/);
});

test('watch rejects missing thread or non-active lane, and suppresses stale wake if lane closes mid-wait', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--issue', 'JB-512',
    '--ledger', ledgerPath,
    '--id', 'm3',
    '--agent', 'm3',
    '--stage', 'spec',
  ]);
  assert.throws(() => runCli(['watch', '--ledger', ledgerPath, '--id', 'm3']), /--thread/);

  const wakeCalls = [];
  const fakeRunner = (_session, args) => {
    if (args[0] === 'agent' && args[1] === 'wait') {
      // Simulate another turn escalating the lane while watch is blocked.
      runCli(['escalate', '--ledger', ledgerPath, '--id', 'm3', '--reason', 'manual stop']);
      return '';
    }
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };

  const res = runCli(
    ['watch', '--ledger', ledgerPath, '--id', 'm3', '--thread', 'thread-123'],
    fakeRunner,
    { waker: (p) => wakeCalls.push(p) }
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.output.woke, false);
  assert.equal(res.output.reason, 'lane_no_longer_active');
  assert.equal(wakeCalls.length, 0);

  // Calling watch on an already escalated lane fails closed.
  assert.throws(
    () => runCli(['watch', '--ledger', ledgerPath, '--id', 'm3', '--thread', 'thread-123'], fakeRunner),
    /not active/
  );
});

test('watch --daemon deduplicates live watcher by pidfile and reports already_running', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--issue', 'JB-512',
    '--ledger', ledgerPath,
    '--id', 'm3',
    '--agent', 'm3',
    '--stage', 'pipeline',
  ]);

  let spawns = 0;
  const fakeSpawner = () => {
    spawns += 1;
    // Return current process.pid so liveness probe (kill(pid, 0)) sees a live watcher.
    return { pid: process.pid };
  };

  const first = runCli(
    ['watch', '--ledger', ledgerPath, '--id', 'm3', '--thread', 'thread-123', '--daemon'],
    undefined,
    { spawner: fakeSpawner }
  );
  assert.equal(first.exitCode, 0);
  assert.equal(first.output.watching, true);
  assert.equal(first.output.already_running, false);
  assert.equal(first.output.pid, process.pid);
  assert.equal(spawns, 1);

  const second = runCli(
    ['watch', '--ledger', ledgerPath, '--id', 'm3', '--thread', 'thread-123', '--daemon'],
    undefined,
    { spawner: fakeSpawner }
  );
  assert.equal(second.exitCode, 0);
  assert.equal(second.output.watching, true);
  assert.equal(second.output.already_running, true);
  assert.equal(second.output.pid, process.pid);
  assert.equal(spawns, 1);
});
