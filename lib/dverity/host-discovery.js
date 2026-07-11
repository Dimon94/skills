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
    item.command.includes(expectedPath) && item.exit_code === 0
  ));
  const messages = records.map((event) => event.item)
    .filter((item) => item?.type === 'agent_message')
    .map((item) => item.text);
  return {
    observedPaths: [...reads, ...hashes].flatMap((item) => skillPaths(item.command)),
    discovered: reads.length + hashes.length > 0,
    read: reads.some((item) => item.command.includes(expectedPath))
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
  const expectedHashes = hashes.filter((item) => item.input.command.includes(expectedPath));
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
  return String(value).match(/\/[^\s"']+\/SKILL\.md/g) || [];
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
  return output.match(new RegExp(`([a-f0-9]{64})\\s+${escaped}`))?.[1] || null;
}

function marker(output, expectedPath, digest, skill) {
  return output.includes('DVERITY_HOST_READ')
    && output.includes(`path=${expectedPath}`)
    && output.includes(`sha256=${digest}`)
    && output.includes(`skill=${skill}`);
}

function evaluateHostTranscript(input) {
  const config = HOSTS[input.host];
  if (!config) throw new Error(`Unknown Dverity host: ${input.host}`);
  const expected = expectedFile(config, input.installRoot, input.manifest);
  const records = events(input.transcript);
  const evidence = input.host === 'agents'
    ? codexEvidence(records, expected.path)
    : claudeEvidence(records, config, expected.path);
  const digest = loadedDigest(evidence.hashOutput, expected.path);
  const wrongCopy = evidence.observedPaths.some((file) => file !== expected.path);
  const hostMarker = marker(evidence.finalOutput, expected.path, digest, config.skill);
  const proof = evidence.finalOutput.includes(`proof=${expected.proof}`);
  const readback = evidence.read && Boolean(digest) && hostMarker && proof;
  let status = 'pass';
  let reason = 'host discovered and read artifact-matching Skill';
  if (wrongCopy) {
    status = 'blocked';
    reason = 'host read a personal/global wrong copy';
  } else if (input.exitCode !== 0) {
    status = 'blocked';
    reason = 'host session failed before artifact readback';
  } else if (!evidence.discovered) {
    status = 'blocked';
    reason = 'host did not discover the projected Skill';
  } else if (evidence.read && digest && hostMarker && !proof) {
    status = 'blocked';
    reason = 'host read lacks artifact content proof';
  } else if (!readback) {
    status = 'blocked';
    reason = 'host discovery lacks an artifact-path digest readback';
  } else if (digest !== expected.digest) {
    status = 'fail';
    reason = 'host loaded digest does not match the frozen artifact';
  }
  return {
    acceptance_id: config.acceptance_id,
    status,
    reason,
    host: input.host,
    version: input.version.trim(),
    skill: config.skill,
    projection: config.projection,
    discovered: evidence.discovered,
    readback,
    source_path: evidence.read ? expected.path : evidence.observedPaths[0] || null,
    expected_digest: expected.digest,
    loaded_digest: digest,
    content_proof: proof ? expected.proof : null,
    artifact_hash: input.manifest.artifact?.hash || null,
    transcript_sha256: crypto.createHash('sha256').update(input.transcript).digest('hex')
  };
}

function prompt(config) {
  const request = 'Read the project-installed Skill through normal skill discovery, then compute '
    + 'its SKILL.md SHA-256 with shasum. Do not search for files or inspect any other skill '
    + 'location. Return one compact line exactly: DVERITY_HOST_READ path=<absolute path> '
    + `sha256=<digest> skill=${config.skill} proof=<exact first non-empty body line longer than `
    + '30 characters after the H1>';
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
    '-p', prompt(config), '--setting-sources', 'project', '--no-session-persistence',
    '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk',
    '--tools', 'Read,Bash', '--allowedTools', 'Read', 'Bash(shasum -a 256 *)',
    '--max-budget-usd', '0.50'
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
