const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOSTS = Object.freeze({
  agents: {
    acceptance_id: 'DV-INS-002',
    executable: 'codex',
    projection: '.agents/skills',
    skill: 'dverity-repair'
  },
  claude: {
    acceptance_id: 'DV-INS-003',
    executable: 'claude',
    projection: '.claude/skills',
    skill: 'merge-remote-review'
  }
});

const TERMINAL_FAILURES = Object.freeze([
  {
    pattern: /authentication_failed|invalid authentication|api error: 401|"(?:api_)?error_status":401/,
    kind: 'auth-error',
    reason: 'host authentication failed before artifact readback'
  },
  {
    pattern: /max(?:imum)?[_ -]?budget|budget (?:exceeded|exhausted)|error_max_budget/,
    kind: 'budget-error',
    reason: 'host budget exhausted before artifact readback'
  },
  {
    pattern: /output[_ -]?format|format[_ -]?error|invalid[^"']*format|json schema/,
    kind: 'format-error',
    reason: 'host output format failed before artifact readback'
  }
]);

const REFUSAL = Object.freeze({
  pattern: /cannot comply|\brefus(?:e|al)|unable to (?:provide|comply)|\bwill not\b/,
  kind: 'refusal',
  reason: 'host refused before returning complete readback facts',
  soft: true
});

function events(transcript) {
  return transcript.split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch (_error) {
      return [];
    }
  });
}

function nestedContent(event) {
  return event.message?.content || [];
}

function codexEvidence(records, expectedPath) {
  const commands = records.map((event) => event.item)
    .filter((item) => item?.type === 'command_execution');
  const reads = commands.filter((item) => item.command.includes('/SKILL.md')
    && !item.command.includes('shasum'));
  const hashes = commands.filter((item) => item.command.includes('shasum')
    && item.command.includes('/SKILL.md'));
  const expectedHashes = hashes.filter((item) => (
    commandReadsPath(item.command, expectedPath) && item.exit_code === 0
  ));
  const messages = records.map((event) => event.item)
    .filter((item) => item?.type === 'agent_message')
    .map((item) => item.text);
  return {
    observedPaths: [...reads, ...hashes].flatMap((item) => skillPaths(item.command)),
    discovered: reads.length + hashes.length > 0,
    read: reads.some((item) => commandReadsPath(item.command, expectedPath))
      || expectedHashes.length > 0,
    hashOutput: expectedHashes.map((item) => item.aggregated_output).join('\n'),
    finalOutput: messages.join('\n')
  };
}

function claudeEvidence(records, config, expectedPath) {
  const init = records.find((event) => event.type === 'system' && event.subtype === 'init');
  const tools = records.flatMap(nestedContent).filter((item) => item.type === 'tool_use');
  const reads = tools.filter((item) => item.name === 'Read');
  const hashes = tools.filter((item) => item.name === 'Bash'
    && item.input?.command?.includes('shasum'));
  const expectedHashes = hashes.filter((item) => commandReadsPath(item.input.command, expectedPath));
  const results = records.flatMap(nestedContent)
    .filter((item) => item.type === 'tool_result')
    .map((item) => String(item.content));
  const final = records.filter((event) => event.type === 'result')
    .map((event) => String(event.result || ''));
  return {
    observedPaths: [
      ...reads.map((item) => item.input?.file_path).filter(Boolean),
      ...hashes.flatMap((item) => skillPaths(item.input.command))
    ],
    discovered: Boolean(init?.skills?.includes(config.skill)),
    read: reads.some((item) => item.input?.file_path === expectedPath)
      || expectedHashes.length > 0,
    hashOutput: expectedHashes.length > 0 ? results.join('\n') : '',
    finalOutput: final.join('\n')
  };
}

function skillPaths(value) {
  return String(value).match(/\/[^\s"'`]+\/SKILL\.md[^\s"'`]*/g) || [];
}

function commandReadsPath(command, expectedPath) {
  return skillPaths(command).includes(expectedPath);
}

function expectedFile(config, installRoot, manifest) {
  const projection = manifest.projections?.find((item) => item.root === config.projection);
  const relative = `${config.skill}/SKILL.md`;
  const file = projection?.files?.find((item) => item.path === relative);
  if (!file || !/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new Error(`Manifest lacks ${config.projection}/${relative}`);
  }
  const filePath = path.join(installRoot, config.projection, relative);
  return { digest: file.sha256, path: filePath, proof: contentProof(filePath) };
}

function contentProof(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const heading = lines.findIndex((line) => /^#\s+\S/.test(line));
  const proof = lines.slice(heading + 1).find((line) => line.trim().length > 30);
  if (heading < 0 || !proof) throw new Error(`Skill content proof is unavailable: ${file}`);
  return proof;
}

function loadedDigest(output, expectedPath) {
  const escaped = expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return output.match(new RegExp(`(?:^|\\s)([a-f0-9]{64})\\s+${escaped}(?=\\s|$)`))?.[1] || null;
}

function containsExact(output, value) {
  const parts = output.split(value);
  return parts.some((before, index) => {
    if (index === parts.length - 1) return false;
    const left = before[before.length - 1];
    const right = parts[index + 1][0];
    return (!left || /[\s"'`=:(\[,]/.test(left)) && (!right || /[\s"'`,;)}\]]/.test(right));
  });
}

function reportedFacts(output, expected, digest, skill) {
  return {
    skill: containsExact(output, skill),
    path: containsExact(output, expected.path),
    digest: Boolean(digest) && containsExact(output, digest),
    content: containsExact(output, expected.proof)
  };
}

function terminalFailure(records, exitCode) {
  const result = records.find((event) => event.type === 'result');
  const text = JSON.stringify(records).toLowerCase();
  const typed = TERMINAL_FAILURES.find(({ pattern }) => pattern.test(text));
  if (typed) return typed;
  if (exitCode !== 0 || result?.is_error) {
    return { kind: 'session-error', reason: 'host session failed before artifact readback' };
  }
  return REFUSAL.pattern.test(text) ? REFUSAL : null;
}

function hostState(input, config) {
  const expected = expectedFile(config, input.installRoot, input.manifest);
  const records = events(input.transcript);
  const evidence = input.host === 'agents'
    ? codexEvidence(records, expected.path)
    : claudeEvidence(records, config, expected.path);
  const digest = loadedDigest(evidence.hashOutput, expected.path);
  const wrongCopy = evidence.observedPaths.some((file) => file !== expected.path);
  const facts = reportedFacts(evidence.finalOutput, expected, digest, config.skill);
  const readback = evidence.read && Object.values(facts).every(Boolean);
  const terminal = terminalFailure(records, input.exitCode);
  return { expected, evidence, digest, wrongCopy, facts, readback, terminal };
}

function hostVerdict(state) {
  const terminalBlocks = state.terminal && (!state.terminal.soft || !state.readback);
  const incompleteContent = state.evidence.read && state.digest
    && state.facts.skill && state.facts.path && state.facts.digest && !state.facts.content;
  const verdicts = [
    [state.wrongCopy, 'blocked', 'wrong-copy', 'host read a personal/global wrong copy'],
    [terminalBlocks, 'blocked', state.terminal?.kind, state.terminal?.reason],
    [!state.evidence.discovered, 'blocked', 'discovery-missing', 'host did not discover the projected Skill'],
    [incompleteContent, 'blocked', 'evidence-incomplete', 'host read lacks artifact content proof'],
    [!state.readback, 'blocked', 'evidence-incomplete', 'host discovery lacks an artifact-path digest readback'],
    [state.digest !== state.expected.digest, 'fail', 'digest-mismatch', 'host loaded digest does not match the frozen artifact']
  ];
  const found = verdicts.find(([matches]) => matches);
  return found ? { status: found[1], kind: found[2], reason: found[3] }
    : { status: 'pass', kind: 'verified-readback', reason: 'host discovered and read artifact-matching Skill' };
}

function hostResult(input, config, state, verdict) {
  return {
    acceptance_id: config.acceptance_id, status: verdict.status,
    terminal_kind: verdict.kind, reason: verdict.reason,
    host: input.host, version: input.version.trim(),
    skill: config.skill, projection: config.projection,
    discovered: state.evidence.discovered, readback: state.readback,
    source_path: state.evidence.read ? state.expected.path : state.evidence.observedPaths[0] || null,
    expected_digest: state.expected.digest, loaded_digest: state.digest,
    content_proof: state.facts.content ? state.expected.proof : null,
    reported_facts: state.facts,
    artifact_hash: input.manifest.artifact?.hash || null,
    transcript_sha256: crypto.createHash('sha256').update(input.transcript).digest('hex')
  };
}

function evaluateHostTranscript(input) {
  const config = HOSTS[input.host];
  if (!config) throw new Error(`Unknown Dverity host: ${input.host}`);
  const state = hostState(input, config);
  return hostResult(input, config, state, hostVerdict(state));
}

function prompt(config) {
  const request = 'Read the project-installed Skill through normal skill discovery, then compute '
    + 'its SKILL.md SHA-256 with shasum. Do not search for files or inspect any other skill '
    + 'location. Report observed facts without attesting, certifying, or declaring pass/fail. '
    + 'Prose or JSON is acceptable. Include the Skill name, exact loaded path, SHA-256, and '
    + 'the exact first non-empty body line longer than 30 characters after the H1.';
  return config.executable === 'claude' ? `/${config.skill} ${request}` : `Use ${config.skill}. ${request}`;
}

function invocation(config, installRoot) {
  if (config.executable === 'codex') {
    return [
      'exec', '--ignore-user-config', '--ephemeral', '--json', '--sandbox', 'read-only',
      '--skip-git-repo-check', '-C', installRoot, prompt(config)
    ];
  }
  return [
    '-p', prompt(config), '--no-session-persistence',
    '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk',
    '--tools', 'Read,Bash', '--allowedTools', 'Read', 'Bash(shasum -a 256 *)',
    '--max-budget-usd', '1.00'
  ];
}

function runHostDiscovery({ host, installRoot, manifest, spawn = spawnSync }) {
  const config = HOSTS[host];
  if (!config) throw new Error(`Unknown Dverity host: ${host}`);
  const options = { cwd: installRoot, encoding: 'utf8', input: '' };
  const version = spawn(config.executable, ['--version'], options);
  if (version.status !== 0) {
    return evaluateHostTranscript({
      host,
      installRoot,
      manifest,
      version: version.stdout || version.stderr || 'unavailable',
      exitCode: version.status,
      transcript: ''
    });
  }
  const session = spawn(config.executable, invocation(config, installRoot), options);
  return evaluateHostTranscript({
    host,
    installRoot,
    manifest,
    version: version.stdout,
    exitCode: session.status,
    transcript: session.stdout || ''
  });
}

module.exports = { evaluateHostTranscript, runHostDiscovery };
