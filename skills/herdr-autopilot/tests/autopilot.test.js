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

test('validateSession rejects default and empty sessions (fail-close)', () => {
  assert.throws(() => validateSession('default'), /refusing session "default"/);
  assert.throws(() => validateSession('DEFAULT'), /refusing session "default"/);
  assert.throws(() => validateSession(''), /cannot be empty/);
  assert.equal(validateSession('autopilot'), 'autopilot');
});

test('poll ignores unmanaged agents and only reads non-working managed lanes', () => {
  const ledgerPath = makeTempLedger();
  runCli([
    'register',
    '--session', 'autopilot',
    '--ledger', ledgerPath,
    '--id', 'feat-a',
    '--agent', 'auto-feat-a',
    '--stage', 'spec',
    '--repo', '/tmp/repo-a',
  ]);
  runCli([
    'register',
    '--session', 'autopilot',
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
            { name: 'manual-human-pane', pane_id: 'w1:p1', status: 'idle' },
            { name: 'auto-feat-a', pane_id: 'w2:p1', status: 'working' },
            { name: 'auto-feat-b', pane_id: 'w2:p2', status: 'done' },
          ],
        },
      });
    }
    if (args[0] === 'agent' && args[1] === 'read' && args[2] === 'auto-feat-b') {
      return JSON.stringify({ result: { text: 'Spec ready. Run /to-tickets next.' } });
    }
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };

  const res = runCli(['poll', '--session', 'autopilot', '--ledger', ledgerPath], fakeRunner);
  assert.equal(res.exitCode, 0);
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
    '--session', 'autopilot',
    '--ledger', ledgerPath,
    '--id', 'triage',
    '--agent', 'ads-triage',
    '--stage', 'spec',
  ]);
  runCli([
    'register',
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
