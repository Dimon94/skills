const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  routeRepairWork,
  validateRepairPacket
} = require('../skills/dverity-repair/scripts/repair-contract');
const {
  decidePostmortem,
  recordPostmortem
} = require('../skills/postmortem/scripts/postmortem-contract');
const {
  decideResearch,
  recordResearch
} = require('../skills/dverity-research/scripts/research-contract');

function run(root, script) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8'
  });
  return {
    command: `node ${script}`,
    exit_code: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function writeFixture(root, implementation) {
  fs.writeFileSync(path.join(root, 'total.js'), implementation);
  fs.writeFileSync(path.join(root, 'original.js'), [
    "const total = require('./total');",
    "if (total([10, 5]) !== 15) { console.error('SYMPTOM:wrong-total'); process.exit(1); }",
    "console.log('original-ok');",
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'regression.js'), [
    "const total = require('./total');",
    "if (total([10, 5]) !== 15) { console.error('SYMPTOM:wrong-total REGRESSION:public-total-boundary'); process.exit(1); }",
    "console.log('regression-ok');",
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'kill-probe.js'), [
    "const total = require('./total');",
    "if (total([]) !== 1) { console.error('kill-refuted'); process.exit(1); }",
    "console.log('kill-survived:empty-starts-at-one');",
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'corroborate.js'), [
    "const total = require('./total');",
    "if (total([2]) !== 3) { console.error('corroboration-missing'); process.exit(1); }",
    "console.log('corroborated:single-item-also-gains-one');",
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'confirm-removal.js'), [
    "const total = require('./total');",
    "if (total([]) !== 0 || total([10, 5]) !== 15) { console.error('confirmation-missing'); process.exit(1); }",
    "console.log('confirmed:removing-initial-one-removes-both-effects');",
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'cleanup-scan.js'), [
    "const fs = require('fs');",
    "const debugFree = !fs.readFileSync('total.js', 'utf8').includes('[DEBUG-');",
    "const prototypeGone = !fs.existsSync('prototype.tmp');",
    "if (!debugFree || !prototypeGone) { console.error('cleanup-incomplete'); process.exit(1); }",
    "console.log('cleanup-proven:total.js,prototype.tmp');",
    ''
  ].join('\n'));
}

function happyPacket(evidence) {
  return {
    schema_version: 1,
    symptom: 'SYMPTOM:wrong-total',
    reproduction: {
      original_red: { ...evidence.originalRed, symptom: 'SYMPTOM:wrong-total' },
      minimized_red: {
        ...evidence.regressionRed,
        symptom: 'SYMPTOM:wrong-total',
        load_bearing: true,
        deterministic: true,
        reproduction_rate: 1
      }
    },
    hypothesis_board: [
      {
        id: 'HYP001',
        cause: 'reduce 初值错误',
        observed_result: '10 + 5 输出 16',
        abductive_ece: 'wrong total <= wrong initial value => empty input also starts at one',
        next_check: '先跑 kill probe，再跑 removal test',
        evidence: 'original.js 与 regression.js 的 red output',
        kill_probe: {
          prediction: '空输入会返回 1；若返回 0 则 refuted',
          ...evidence.killProbe,
          observed: evidence.killProbe.stdout,
          result: 'survived'
        },
        corroboration: {
          prediction: '单元素输入也会多 1',
          ...evidence.corroboration,
          observed: evidence.corroboration.stdout
        },
        confirm_test: {
          kind: 'removal',
          ...evidence.confirmation,
          observed: evidence.confirmation.stdout,
          result: 'confirmed'
        },
        rung: 'confirmed'
      }
    ],
    single_candidate_reason: '代码路径只有一个算术初值，未编造陪跑假设',
    cause_statement: 'root cause: reduce 初值错误',
    injection: {
      causal_edge: '初值 1 -> 所有总数多 1',
      change: '把初值改为 0'
    },
    frt_nbr: {
      desired_effect: '公开 total 边界返回正确结果',
      negative_branch: '空数组行为可能改变',
      prevention_check: '回归同时覆盖空数组'
    },
    regression: {
      boundary: 'public total module',
      before: evidence.regressionRed,
      after: evidence.regressionGreen
    },
    original_recheck: evidence.originalGreen,
    cleanup: {
      verification: {
        ...evidence.cleanupScan,
        observed: evidence.cleanupScan.stdout
      },
      scanned_paths: ['total.js', 'prototype.tmp'],
      prototypes: 'removed'
    },
    authority: {
      remote_actions_performed: []
    }
  };
}

function packetFixture() {
  const red = {
    command: 'node symptom.js',
    exit_code: 1,
    stdout: '',
    stderr: 'SYMPTOM:wrong-total'
  };
  const green = {
    command: 'node symptom.js',
    exit_code: 0,
    stdout: 'ok',
    stderr: ''
  };
  const probe = {
    command: 'node probe.js',
    exit_code: 0,
    stdout: 'grounded probe output',
    stderr: ''
  };
  return happyPacket({
    originalRed: { ...red, command: 'node original.js' },
    regressionRed: { ...red, command: 'node regression.js' },
    regressionGreen: { ...green, command: 'node regression.js' },
    originalGreen: { ...green, command: 'node original.js' },
    killProbe: { ...probe, command: 'node kill-probe.js' },
    corroboration: { ...probe, command: 'node corroborate.js' },
    confirmation: { ...probe, command: 'node confirm-removal.js' },
    cleanupScan: { ...probe, command: 'node cleanup-scan.js' }
  });
}

function refutedHypothesis(source, id) {
  const hypothesis = structuredClone(source);
  hypothesis.id = id;
  hypothesis.rung = 'refuted';
  hypothesis.kill_probe = {
    prediction: `${id} independent prediction`,
    command: `node ${id.toLowerCase()}-kill.js`,
    exit_code: 1,
    observed: `${id} killing fact`,
    result: 'refuted'
  };
  hypothesis.missing_confirmation = 'kill probe 已 refute，无需 confirm';
  delete hypothesis.corroboration;
  delete hypothesis.confirm_test;
  return hypothesis;
}

describe('dverity-repair Verified Local contract', () => {
  test('accepts grounded happy-path evidence from a disposable buggy project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-repair-'));
    writeFixture(root, 'module.exports = (items) => items.reduce((sum, value) => sum + value, 1);\n');
    const originalRed = run(root, 'original.js');
    const regressionRed = run(root, 'regression.js');
    const killProbe = run(root, 'kill-probe.js');
    const corroboration = run(root, 'corroborate.js');
    fs.writeFileSync(path.join(root, 'prototype.tmp'), 'temporary proof\n');

    writeFixture(root, 'module.exports = (items) => items.reduce((sum, value) => sum + value, 0);\n');
    const confirmation = run(root, 'confirm-removal.js');
    const regressionGreen = run(root, 'regression.js');
    const originalGreen = run(root, 'original.js');
    fs.rmSync(path.join(root, 'prototype.tmp'));
    const cleanupScan = run(root, 'cleanup-scan.js');

    expect(validateRepairPacket(happyPacket({
      originalRed,
      regressionRed,
      regressionGreen,
      originalGreen,
      killProbe,
      corroboration,
      confirmation,
      cleanupScan
    }))).toEqual({
      success: true,
      terminal: 'verified-local-repair'
    });
  });

  test.each([
    ['no-red', (packet) => { packet.reproduction.original_red.exit_code = 0; }],
    ['wrong-symptom', (packet) => { packet.reproduction.original_red.stderr = 'OTHER:failure'; }],
    ['flaky-low-rate', (packet) => {
      packet.reproduction.minimized_red.deterministic = false;
      packet.reproduction.minimized_red.reproduction_rate = 0.01;
    }],
    ['support-only hypothesis', (packet) => {
      packet.hypothesis_board[0].kill_probe.result = 'not-run';
      packet.hypothesis_board[0].rung = 'corroborated';
      packet.hypothesis_board[0].missing_confirmation = '需要 removal test';
      packet.cause_statement = 'probable cause: reduce 初值错误';
    }]
  ])('blocks %s evidence without claiming repair success', (_name, mutate) => {
    const packet = packetFixture();
    mutate(packet);

    expect(validateRepairPacket(packet)).toMatchObject({
      success: false,
      terminal: 'blocked',
      next_owner: 'user-or-external-executor',
      product_mutations_performed: []
    });
  });

  test('keeps the disconfirming kill probe independent from confirmation', () => {
    const packet = packetFixture();
    packet.hypothesis_board[0].confirm_test.command = packet.hypothesis_board[0].kill_probe.command;

    expect(validateRepairPacket(packet)).toMatchObject({
      success: false,
      terminal: 'blocked'
    });
  });

  test.each([
    ['next check', (packet) => { delete packet.hypothesis_board[0].next_check; }],
    ['evidence', (packet) => { delete packet.hypothesis_board[0].evidence; }],
    ['independent corroboration', (packet) => { delete packet.hypothesis_board[0].corroboration; }],
    ['observed confirmation', (packet) => { delete packet.hypothesis_board[0].confirm_test.observed; }],
    ['confirm test', (packet) => { delete packet.hypothesis_board[0].confirm_test; }]
  ])('blocks a hypothesis without %s', (_name, mutate) => {
    const packet = packetFixture();
    mutate(packet);

    expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });
  });

  test('uses probable language only with a named missing confirmation', () => {
    const packet = packetFixture();
    packet.hypothesis_board[0].rung = 'corroborated';
    packet.hypothesis_board[0].confirm_test = { kind: 'action', result: 'not-run' };
    packet.hypothesis_board[0].missing_confirmation = '需要 removal test';
    packet.cause_statement = 'probable cause: reduce 初值错误';

    expect(validateRepairPacket(packet)).toEqual({
      success: true,
      terminal: 'verified-local-repair'
    });

    packet.cause_statement = 'root cause: reduce 初值错误';
    expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });
  });

  test('rejects probable language after an independent confirm test has passed', () => {
    const packet = packetFixture();
    packet.hypothesis_board[0].rung = 'corroborated';
    packet.hypothesis_board[0].missing_confirmation = '错误地声称仍缺 confirmation';
    packet.cause_statement = 'probable cause: reduce 初值错误';

    expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });
  });

  test('accepts explicit Chinese trust-language labels', () => {
    const confirmed = packetFixture();
    confirmed.cause_statement = '根因: reduce 初值错误';
    expect(validateRepairPacket(confirmed)).toMatchObject({ success: true });

    const probable = packetFixture();
    probable.hypothesis_board[0].rung = 'corroborated';
    probable.hypothesis_board[0].confirm_test = { kind: 'removal', result: 'not-run' };
    probable.hypothesis_board[0].missing_confirmation = '需要 removal test';
    probable.cause_statement = '可能原因: reduce 初值错误';
    expect(validateRepairPacket(probable)).toMatchObject({ success: true });
  });

  test('accepts a non-deterministic symptom once its measured reproduction rate is useful', () => {
    const packet = packetFixture();
    packet.reproduction.minimized_red.deterministic = false;
    packet.reproduction.minimized_red.reproduction_rate = 0.5;

    expect(validateRepairPacket(packet)).toMatchObject({ success: true });
  });

  test.each([undefined, '0.8', -0.1, 1.1])(
    'rejects invalid reproduction-rate evidence %p',
    (reproductionRate) => {
      const packet = packetFixture();
      packet.reproduction.minimized_red.reproduction_rate = reproductionRate;

      expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });
    }
  );

  test.each([
    ['non-array board', 'bad'],
    ['null board row', [null]],
    ['primitive board row', [42]]
  ])('returns blocked instead of throwing for %s', (_name, hypothesisBoard) => {
    const packet = packetFixture();
    packet.hypothesis_board = hypothesisBoard;

    expect(() => validateRepairPacket(packet)).not.toThrow();
    expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });
  });

  test('validates every row in a complete multi-candidate Hypothesis board', () => {
    const packet = packetFixture();
    packet.hypothesis_board.push(
      refutedHypothesis(packet.hypothesis_board[0], 'HYP002'),
      refutedHypothesis(packet.hypothesis_board[0], 'HYP003')
    );
    delete packet.single_candidate_reason;

    expect(validateRepairPacket(packet)).toMatchObject({ success: true });

    packet.hypothesis_board[1].rung = 'invalid-rung';
    expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });

    packet.hypothesis_board[1].rung = 'refuted';
    packet.hypothesis_board[1].kill_probe.result = 'survived';
    expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });
  });

  test.each(['corroborated', 'conjectured'])(
    'rejects confirmed evidence hidden on a secondary %s row',
    (rung) => {
      const packet = packetFixture();
      const secondary = structuredClone(packet.hypothesis_board[0]);
      secondary.id = 'HYP002';
      secondary.rung = rung;
      packet.hypothesis_board.push(
        secondary,
        refutedHypothesis(packet.hypothesis_board[0], 'HYP003')
      );
      delete packet.single_candidate_reason;

      expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });
    }
  );

  test('fails closed when Repair evidence contains remote mutation', () => {
    const packet = packetFixture();
    packet.authority.remote_actions_performed = ['push'];

    expect(validateRepairPacket(packet)).toMatchObject({
      success: false,
      terminal: 'blocked'
    });
  });

  test.each([
    ['original recheck still emits the symptom', (packet) => {
      packet.original_recheck.stderr = packet.symptom;
    }],
    ['regression green runs a different boundary command', (packet) => {
      packet.regression.after.command = 'node easier-check.js';
    }]
  ])('rejects false green when %s', (_name, mutate) => {
    const packet = packetFixture();
    mutate(packet);

    expect(validateRepairPacket(packet)).toMatchObject({
      success: false,
      terminal: 'blocked'
    });
  });

  test.each([
    ['missing cleanup command', (packet) => { delete packet.cleanup.verification.command; }],
    ['missing cleanup observation', (packet) => { delete packet.cleanup.verification.observed; }],
    ['missing cleanup scope', (packet) => { packet.cleanup.scanned_paths = []; }],
    ['surviving prototype', (packet) => { packet.cleanup.prototypes = 'present'; }]
  ])('blocks %s', (_name, mutate) => {
    const packet = packetFixture();
    mutate(packet);

    expect(validateRepairPacket(packet)).toMatchObject({ success: false, terminal: 'blocked' });
  });

  test.each([
    ['confirmed-defect', 'confirmed', { status: 'route', target: 'dverity-repair' }],
    ['feature-gap', 'confirmed', { status: 'route', target: 'external-wayfinder-executor' }],
    ['requirement-change', 'confirmed', { status: 'route', target: 'external-wayfinder-executor' }],
    ['product-intent-gap', 'confirmed', { status: 'route', target: 'external-wayfinder-executor' }],
    ['confirmed-defect', 'corroborated', { status: 'blocked', target: null }],
    ['missing-intent', 'unknown', { status: 'blocked', target: null }]
  ])('routes %s with %s evidence to the sole owner', (kind, evidenceStatus, expected) => {
    expect(routeRepairWork({ kind, evidence_status: evidenceStatus })).toEqual(expected);
  });

  test.each([
    ['recurrence', 'unknown', false, true, false],
    ['failed-verification', 'unknown', false, true, false],
    ['review-escape', 'unknown', false, true, true],
    ['ordinary-failure', 'confirmed', true, false, false],
    ['confirmed-reusable-lesson', 'confirmed', true, false, true],
    ['explicit-request', 'unknown', false, false, true],
    ['unconfirmed-lesson', 'suspected', true, false, false]
  ])('routes the %s postmortem trigger without speculative evidence', (
    trigger,
    rootCauseStatus,
    reusable,
    recall,
    record
  ) => {
    expect(decidePostmortem({ trigger, root_cause_status: rootCauseStatus, reusable }))
      .toMatchObject({ recall, record });
  });

  test('records only a confirmed reusable lesson, review escape, or explicit request', () => {
    expect(decidePostmortem({
      trigger: 'ordinary-failure',
      root_cause_status: 'confirmed',
      reusable: true
    })).toMatchObject({ record: false });
    expect(decidePostmortem({
      trigger: 'confirmed-reusable-lesson',
      root_cause_status: 'confirmed',
      reusable: true
    })).toMatchObject({ record: true });
    expect(decidePostmortem({
      trigger: 'unconfirmed-lesson',
      root_cause_status: 'suspected',
      reusable: true
    })).toMatchObject({ record: false });
  });

  test('creates no durable evidence on the normal path and writes only after real triggers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-evidence-'));
    const ordinary = decidePostmortem({
      trigger: 'ordinary-failure',
      root_cause_status: 'unknown',
      reusable: false
    });
    const noGap = decideResearch({ evidence_gap: false, local_grounded: true, persist: true });

    expect(recordPostmortem({
      projectRoot: root,
      decision: ordinary,
      slug: 'ordinary',
      markdown: '# Ordinary\n'
    })).toEqual({ written: false, path: null });
    expect(recordResearch({
      projectRoot: root,
      decision: noGap,
      slug: 'no-gap',
      markdown: '# No gap\n'
    })).toEqual({ written: false, path: null });
    expect(fs.existsSync(path.join(root, 'docs'))).toBe(false);

    const escape = decidePostmortem({
      trigger: 'review-escape',
      root_cause_status: 'confirmed',
      reusable: true
    });
    const evidenceGap = decideResearch({
      evidence_gap: true,
      local_grounded: true,
      persist: true
    });
    const incident = recordPostmortem({
      projectRoot: root,
      decision: escape,
      slug: 'review-escape',
      markdown: '# Review escape\n\nConfirmed reusable lesson.\n'
    });
    const research = recordResearch({
      projectRoot: root,
      decision: evidenceGap,
      slug: 'api-evidence',
      markdown: '# API evidence\n\nPrimary sources.\n'
    });

    expect(incident.written).toBe(true);
    expect(research.written).toBe(true);
    expect(fs.readFileSync(incident.path, 'utf8')).toContain('Confirmed reusable lesson');
    expect(fs.readFileSync(research.path, 'utf8')).toContain('Primary sources');
  });

  test('blocks durable research before local grounding', () => {
    expect(decideResearch({
      evidence_gap: true,
      local_grounded: false,
      persist: true
    })).toEqual({ status: 'blocked', consult: false, record: false });
  });

  test.each([
    ['postmortem', recordPostmortem],
    ['research', recordResearch]
  ])('refuses to write %s evidence through a symlinked docs directory', (_name, writer) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-root-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-outside-'));
    fs.symlinkSync(outside, path.join(root, 'docs'), 'dir');

    expect(() => writer({
      projectRoot: root,
      decision: { record: true },
      slug: 'escape-attempt',
      markdown: '# Must stay inside\n'
    })).toThrow(/symlink|outside project root/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});
