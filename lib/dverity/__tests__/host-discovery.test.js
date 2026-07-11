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

function claudeTranscript(root = ROOT, digest = CLAUDE_DIGEST, proof = CLAUDE_PROOF) {
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
      result: `DVERITY_HOST_READ path=${skill} sha256=${digest} skill=merge-remote-review proof=${proof}`
    }
  ]);
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

  test('reports discovered-but-unread Claude as blocked when authentication fails', () => {
    const transcript = lines([
      { type: 'system', subtype: 'init', skills: ['merge-remote-review'] },
      { type: 'result', subtype: 'success', is_error: true, result: 'authentication_failed' }
    ]);

    expect(evaluateHostTranscript({
      host: 'claude',
      installRoot: ROOT,
      manifest: manifest(),
      version: '2.1.198 (Claude Code)',
      exitCode: 1,
      transcript
    })).toMatchObject({
      status: 'blocked',
      discovered: true,
      readback: false,
      reason: expect.stringMatching(/host session/i)
    });
  });

  test('launches Codex with project discovery, ephemeral state, and a read-only sandbox', () => {
    const calls = [];
    const spawn = (command, args) => {
      calls.push([command, args]);
      if (args[0] === '--version') return { status: 0, stdout: 'codex-cli 0.138.0\n', stderr: '' };
      return { status: 0, stdout: codexTranscript(), stderr: '' };
    };

    expect(runHostDiscovery({
      host: 'agents',
      installRoot: ROOT,
      manifest: manifest(),
      spawn
    }).status).toBe('pass');
    expect(calls[1]).toEqual([
      'codex',
      expect.arrayContaining([
        'exec', '--ignore-user-config', '--ephemeral', '--json',
        '--sandbox', 'read-only', '--skip-git-repo-check', '-C', ROOT
      ])
    ]);
  });
});
