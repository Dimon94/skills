const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evaluateHostTranscript,
  runHostDiscovery
} = require('../host-discovery');

const AGENTS_DIGEST = 'a'.repeat(64);
const CLAUDE_DIGEST = 'b'.repeat(64);
const AGENTS_PROOF = '`dverity-repair` diagnoses and repairs confirmed defects. Read';
const CLAUDE_PROOF = 'Read `../../DVERITY.md` and own only Merge through Verified Remote Main. The';
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-host-evidence-')));

function writeSkill(relative, heading, proof) {
  const file = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# ${heading}\n\n${proof}\n`);
}

writeSkill('.agents/skills/dverity-repair/SKILL.md', 'Dverity Repair', AGENTS_PROOF);
writeSkill('.claude/skills/merge-remote-review/SKILL.md', 'Merge Remote Review', CLAUDE_PROOF);
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function manifest() {
  return {
    artifact: { hash: 'f'.repeat(64) },
    projections: [
      {
        root: '.agents/skills',
        files: [{ path: 'dverity-repair/SKILL.md', sha256: AGENTS_DIGEST }]
      },
      {
        root: '.claude/skills',
        files: [{ path: 'merge-remote-review/SKILL.md', sha256: CLAUDE_DIGEST }]
      }
    ]
  };
}

function lines(events) {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

function codexTranscript(root = ROOT, digest = AGENTS_DIGEST, proof = AGENTS_PROOF) {
  const skill = path.join(root, '.agents/skills/dverity-repair/SKILL.md');
  return lines([
    {
      type: 'item.completed',
      item: { type: 'command_execution', command: `sed -n 1,220p ${skill}`, aggregated_output: '# Dverity Repair' }
    },
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: `shasum -a 256 ${skill}`,
        aggregated_output: `${digest}  ${skill}\n`,
        exit_code: 0
      }
    },
    {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: `DVERITY_HOST_READ path=${skill} sha256=${digest} skill=dverity-repair proof=${proof}`
      }
    }
  ]);
}

function claudeTranscript(root = ROOT, digest = CLAUDE_DIGEST, proof = CLAUDE_PROOF, report) {
  const skill = path.join(root, '.claude/skills/merge-remote-review/SKILL.md');
  return lines([
    {
      type: 'system',
      subtype: 'init',
      claude_code_version: '2.1.198',
      skills: ['merge-remote-review']
    },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: skill } }] }
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: `shasum -a 256 ${skill}` } }]
      }
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', content: `${digest}  ${skill}` }] }
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: report || `DVERITY_HOST_READ path=${skill} sha256=${digest} skill=merge-remote-review proof=${proof}`
    }
  ]);
}

function evaluateClaude(transcript, exitCode = 0) {
  return evaluateHostTranscript({
    host: 'claude',
    installRoot: ROOT,
    manifest: manifest(),
    version: '2.1.198 (Claude Code)',
    exitCode,
    transcript
  });
}

function terminalTranscript(result) {
  return lines([
    { type: 'system', subtype: 'init', skills: ['merge-remote-review'] },
    { type: 'result', ...result }
  ]);
}

function claudeHashTranscript(file, report, digest = CLAUDE_DIGEST) {
  return lines([
    { type: 'system', subtype: 'init', skills: ['merge-remote-review'] },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: `shasum -a 256 ${file}` } }] }
    },
    { type: 'user', message: { content: [{ type: 'tool_result', content: `${digest}  ${file}` }] } },
    { type: 'result', subtype: 'success', is_error: false, result: report }
  ]);
}

function captureLaunch(host, version, transcript) {
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, args]);
    return args[0] === '--version'
      ? { status: 0, stdout: `${version}\n`, stderr: '' }
      : { status: 0, stdout: transcript, stderr: '' };
  };
  const result = runHostDiscovery({ host, installRoot: ROOT, manifest: manifest(), spawn });
  return { calls, result };
}

describe('Dverity real-host discovery evidence', () => {
  test.each([
    ['agents', 'codex-cli 0.138.0', codexTranscript()],
    ['claude', '2.1.198 (Claude Code)', claudeTranscript()]
  ])('accepts %s only after discovered artifact-path readback', (host, version, transcript) => {
    const result = evaluateHostTranscript({
      host,
      installRoot: ROOT,
      manifest: manifest(),
      version,
      exitCode: 0,
      transcript
    });

    expect(result).toMatchObject({
      status: 'pass',
      host,
      version,
      discovered: true,
      readback: true,
      artifact_hash: 'f'.repeat(64)
    });
    expect(result.loaded_digest).toBe(result.expected_digest);
    expect(result.source_path).toContain(`/${result.projection}/`);
  });

  test('accepts Codex native Skill injection when shasum is the only file read event', () => {
    const skill = path.join(ROOT, '.agents/skills/dverity-repair/SKILL.md');
    const transcript = lines([
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: `shasum -a 256 ${skill}`,
          aggregated_output: `${AGENTS_DIGEST}  ${skill}\n`,
          exit_code: 0
        }
      },
      {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: `DVERITY_HOST_READ path=${skill} sha256=${AGENTS_DIGEST} skill=dverity-repair proof=${AGENTS_PROOF}`
        }
      }
    ]);

    expect(evaluateHostTranscript({
      host: 'agents',
      installRoot: ROOT,
      manifest: manifest(),
      version: 'codex-cli 0.138.0',
      exitCode: 0,
      transcript
    })).toMatchObject({ status: 'pass', discovered: true, readback: true });
  });

  test('accepts complete labeled facts when Claude refuses an attestation-like marker', () => {
    const skill = path.join(ROOT, '.claude/skills/merge-remote-review/SKILL.md');
    const report = [
      'I cannot provide an attestation token. I can report the observed facts:',
      'Skill: merge-remote-review',
      `Path: ${skill}`,
      `SHA-256: ${CLAUDE_DIGEST}`,
      `Content proof: ${CLAUDE_PROOF}`
    ].join('\n');

    expect(evaluateHostTranscript({
      host: 'claude',
      installRoot: ROOT,
      manifest: manifest(),
      version: '2.1.198 (Claude Code)',
      exitCode: 0,
      transcript: claudeTranscript(ROOT, CLAUDE_DIGEST, CLAUDE_PROOF, report)
    })).toMatchObject({ status: 'pass', discovered: true, readback: true });
  });

  test('blocks Claude personal/global wrong-copy even when its digest looks valid', () => {
    const staleRoot = '/Users/example/.claude/skills/merge-remote-review/SKILL.md';
    const transcript = claudeTranscript('/Users/example', CLAUDE_DIGEST)
      .replace('/Users/example/.claude/skills/merge-remote-review/SKILL.md', staleRoot);

    expect(evaluateHostTranscript({
      host: 'claude',
      installRoot: ROOT,
      manifest: manifest(),
      version: '2.1.198 (Claude Code)',
      exitCode: 0,
      transcript
    })).toMatchObject({
      status: 'blocked',
      discovered: true,
      readback: false,
      reason: expect.stringMatching(/wrong copy/i)
    });
  });

  test('blocks a native hash read of an expected-path prefix such as SKILL.md.bak', () => {
    const expected = path.join(ROOT, '.claude/skills/merge-remote-review/SKILL.md');
    const stale = `${expected}.bak`;
    const report = [
      'Skill: merge-remote-review',
      `Path: ${expected}`,
      `SHA-256: ${CLAUDE_DIGEST}`,
      `Content proof: ${CLAUDE_PROOF}`
    ].join('\n');
    expect(evaluateClaude(claudeHashTranscript(stale, report))).toMatchObject({
      status: 'blocked',
      terminal_kind: 'wrong-copy',
      readback: false
    });
  });

  test.each([
    ['path prefix', (skill) => claudeTranscript(ROOT, CLAUDE_DIGEST, CLAUDE_PROOF, [
      'Skill: merge-remote-review', `Path: prefix${skill}`,
      `SHA-256: ${CLAUDE_DIGEST}`, `Content proof: ${CLAUDE_PROOF}`
    ].join('\n'))],
    ['65-digit hash', (skill) => claudeTranscript()
      .replace(`${CLAUDE_DIGEST}  ${skill}`, `c${CLAUDE_DIGEST}  ${skill}`)]
  ])('blocks a reported %s containing expected evidence only as a suffix', (_label, transcriptFor) => {
    const skill = path.join(ROOT, '.claude/skills/merge-remote-review/SKILL.md');
    expect(evaluateClaude(transcriptFor(skill))).toMatchObject({
      status: 'blocked',
      terminal_kind: 'evidence-incomplete',
      readback: false
    });
  });

  test('blocks filesystem-only output that has no real host read event', () => {
    const skill = path.join(ROOT, '.claude/skills/merge-remote-review/SKILL.md');
    const transcript = lines([
      { type: 'system', subtype: 'init', skills: ['merge-remote-review'] },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: `DVERITY_HOST_READ path=${skill} sha256=${CLAUDE_DIGEST} proof=${CLAUDE_PROOF}`
      }
    ]);

    expect(evaluateHostTranscript({
      host: 'claude',
      installRoot: ROOT,
      manifest: manifest(),
      version: '2.1.198 (Claude Code)',
      exitCode: 0,
      transcript
    })).toMatchObject({
      status: 'blocked',
      discovered: true,
      readback: false,
      reason: expect.stringMatching(/readback/i)
    });
  });

  test('blocks a correct file digest when the host cannot return artifact content proof', () => {
    expect(evaluateHostTranscript({
      host: 'agents',
      installRoot: ROOT,
      manifest: manifest(),
      version: 'codex-cli 0.138.0',
      exitCode: 0,
      transcript: codexTranscript(ROOT, AGENTS_DIGEST, 'guessed-from-skill-name')
    })).toMatchObject({
      status: 'blocked',
      discovered: true,
      readback: false,
      reason: expect.stringMatching(/content proof/i)
    });
  });

  test('fails an artifact-path read with a different digest', () => {
    expect(evaluateHostTranscript({
      host: 'agents',
      installRoot: ROOT,
      manifest: manifest(),
      version: 'codex-cli 0.138.0',
      exitCode: 0,
      transcript: codexTranscript(ROOT, 'c'.repeat(64))
    })).toMatchObject({
      status: 'fail',
      discovered: true,
      readback: true,
      reason: expect.stringMatching(/digest/i)
    });
  });

  test.each([
    ['authentication', { subtype: 'success', is_error: true, api_error_status: 401, result: 'Invalid credentials' }, 1, 'auth-error', /authentication/i],
    ['budget', { subtype: 'error_max_budget_usd', is_error: true, result: 'Maximum budget exceeded' }, 1, 'budget-error', /budget/i],
    ['format', { subtype: 'error_output_format', is_error: true, result: 'Invalid output format for stream-json' }, 1, 'format-error', /format/i],
    ['refusal', { subtype: 'success', is_error: false, result: 'I cannot comply with this request.' }, 0, 'refusal', /refus/i],
    ['session', { subtype: 'error_during_execution', is_error: true, result: 'Unexpected transport failure' }, 1, 'session-error', /session/i]
  ])('reports Claude %s terminal state precisely', (_label, event, exitCode, terminalKind, reason) => {
    expect(evaluateClaude(terminalTranscript(event), exitCode)).toMatchObject({
      status: 'blocked',
      terminal_kind: terminalKind,
      discovered: true,
      readback: false,
      reason: expect.stringMatching(reason)
    });
  });

  test.each([
    [
      'path',
      `Skill: merge-remote-review\nSHA-256: ${CLAUDE_DIGEST}\nContent: ${CLAUDE_PROOF}`
    ],
    [
      'digest',
      `Skill: merge-remote-review\nPath: ${path.join(ROOT, '.claude/skills/merge-remote-review/SKILL.md')}\nContent: ${CLAUDE_PROOF}`
    ],
    [
      'content',
      `Skill: merge-remote-review\nPath: ${path.join(ROOT, '.claude/skills/merge-remote-review/SKILL.md')}\nSHA-256: ${CLAUDE_DIGEST}`
    ]
  ])('blocks a facts report missing %s evidence', (missing, report) => {
    const result = evaluateHostTranscript({
      host: 'claude',
      installRoot: ROOT,
      manifest: manifest(),
      version: '2.1.198 (Claude Code)',
      exitCode: 0,
      transcript: claudeTranscript(ROOT, CLAUDE_DIGEST, CLAUDE_PROOF, report)
    });

    expect(result).toMatchObject({
      status: 'blocked',
      terminal_kind: 'evidence-incomplete',
      readback: false,
      reported_facts: { [missing]: false }
    });
  });

  test('launches Codex with project discovery, ephemeral state, and a read-only sandbox', () => {
    const { calls, result } = captureLaunch('agents', 'codex-cli 0.138.0', codexTranscript());
    expect(result.status).toBe('pass');
    expect(calls[1]).toEqual([
      'codex',
      expect.arrayContaining([
        'exec', '--ignore-user-config', '--ephemeral', '--json',
        '--sandbox', 'read-only', '--skip-git-repo-check', '-C', ROOT
      ])
    ]);
  });

  test('launches Claude with normal authenticated settings and the authorized budget cap', () => {
    const { calls, result } = captureLaunch('claude', '2.1.198 (Claude Code)', claudeTranscript());
    expect(result.status).toBe('pass');
    expect(calls[1][1]).not.toContain('--setting-sources');
    expect(calls[1][1].join(' ')).not.toContain('DVERITY_HOST_READ');
    expect(calls[1][1].join(' ')).toContain('Report observed facts');
    expect(calls[1][1]).toEqual(expect.arrayContaining([
      '--no-session-persistence', '--permission-mode', 'dontAsk',
      '--max-budget-usd', '1.00'
    ]));
  });
});
