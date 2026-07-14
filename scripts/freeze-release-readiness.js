#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const catalog = require('../acceptance/catalog.json');
const { generateAcceptancePacket } = require('../lib/acceptance/ledger');
const {
  auditArtifactFreeze,
  auditDependencyOrder,
  auditPreReleasePacket,
  auditPrimaryOwnership,
  expectedPreReleaseOutcome,
  parsePrimaryOwners,
  validateReleaseHandoff
} = require('../lib/dverity/release/release-readiness');
const {
  RELEASE_PROVENANCE,
  assertIntegrationProvenance,
  collectReleaseProvenance
} = require('../lib/dverity/release/provenance');
const { textSetSha256 } = require('../lib/dverity/review/review-item-record');

const ROOT = path.resolve(__dirname, '..');
let REPO;
const TARGET = RELEASE_PROVENANCE.integration.target;
const SOURCE_THREAD = '019f4eac-d73f-7770-9fdb-95244911c96e';
const WORKTREE = ROOT;
const COMMENT_IDS = Object.freeze({
  65: 4941223077, 66: 4941642959, 67: 4941831809, 68: 4942075991,
  69: 4942303725, 70: 4942453796, 71: 4941888753, 72: 4942970687,
  73: 4943284114, 74: 4943689767, 75: 4943128534, 76: 4944063301,
  77: 4944290054
});
const HOST_CARRY = Object.freeze({
  'DV-INS-002': {
    evidence_head: 'cea3926b5cb3e78076b36f88d9c856195274941a',
    comment_id: 4942372685,
    skill_path: 'skills/dverity-repair/SKILL.md',
    host: 'agents',
    executable: 'codex',
    version: 'codex-cli 0.138.0'
  },
  'DV-INS-003': {
    evidence_head: 'a8a354193e26e7ef9dcfa16cc7ade77f0f5aad50',
    comment_id: 4942970687,
    skill_path: 'skills/merge-remote-review/SKILL.md',
    host: 'claude',
    executable: 'claude',
    version: '2.1.198'
  }
});
const EXECUTOR_TESTS = Object.freeze({
  65: ['lib/acceptance/__tests__/ledger.test.js'],
  66: ['lib/dverity/__tests__/install/skill-source.test.js', 'test/dverity-package-source.test.js'],
  67: ['test/dverity-repair-verified-local.test.js', 'test/postmortem-skill-contract.test.js'],
  68: ['test/dverity-simplify-contract.test.js', 'lib/dverity/__tests__/review/submit.test.js'],
  69: ['lib/dverity/__tests__/review/merge.test.js'],
  70: ['lib/dverity/__tests__/review/landing.test.js'],
  71: ['lib/dverity/__tests__/install/lifecycle.test.js'],
  72: [
    'lib/dverity/__tests__/install/host-projections.test.js',
    'lib/dverity/__tests__/install/host-discovery.test.js'
  ],
  73: ['lib/dverity/__tests__/migration/journal.test.js'],
  74: [
    'lib/dverity/__tests__/install/runtime-data.test.js',
    'lib/dverity/__tests__/migration/journal.test.js',
    'lib/dverity/__tests__/install/lifecycle.test.js',
    'test/dverity-package-source.test.js',
    'test/postmortem-skill-contract.test.js'
  ],
  75: ['lib/dverity/downstream-sync/__tests__/index.test.js'],
  76: ['test/dverity-legacy-cutover.test.js'],
  77: ['test/dverity-current-surface.test.js'],
  78: [
    'lib/dverity/__tests__/release/release-readiness.test.js',
    'lib/dverity/__tests__/review/submit.test.js',
    'test/dverity-package-source.test.js'
  ],
  82: ['lib/dverity/__tests__/release/publish-workflow.test.js'],
  84: [
    'lib/dverity/__tests__/release/release-readiness.test.js',
    'lib/dverity/__tests__/release/publish-workflow.test.js'
  ]
});

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: options.encoding === null ? null : 'utf8',
    env: options.env || process.env
  });
  if (result.status !== 0) {
    const output = Buffer.isBuffer(result.stdout)
      ? Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)]).toString()
      : `${result.stdout || ''}${result.stderr || ''}`;
    throw new Error(`${command} ${args.join(' ')} failed\n${output}`);
  }
  return result.stdout;
}

function git(...args) {
  return execute('git', args).trim();
}

function repositoryCoordinate() {
  const remote = git('remote', 'get-url', 'origin');
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error('origin must identify one GitHub repository');
  return `${match[1]}/${match[2]}`;
}

function digest(value, algorithm = 'sha256', encoding = 'hex') {
  return crypto.createHash(algorithm).update(value).digest(encoding);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(file, value) {
  fs.writeFileSync(file, json(value), { flag: 'wx' });
  return digest(fs.readFileSync(file));
}

function assertCleanHead() {
  const base = git('rev-parse', TARGET);
  const head = git('rev-parse', 'HEAD');
  const commits = git('rev-list', '--reverse', `${TARGET}..HEAD`).split('\n').filter(Boolean);
  const [targetOnly, headOnly] = git('rev-list', '--left-right', '--count', `${TARGET}...HEAD`)
    .split(/\s+/).map(Number);
  const value = collectReleaseProvenance({
    run: (command, args) => execute(command, args).trim(),
    integration: {
      branch: git('branch', '--show-current'),
      base,
      head,
      commits
    }
  });
  return assertIntegrationProvenance(value, {
    dirty: Boolean(git('status', '--porcelain=v1', '--untracked-files=all')),
    target_only: targetOnly,
    head_only: headOnly,
    commit_lines: git('rev-list', '--reverse', '--parents', `${TARGET}..HEAD`)
      .split('\n').filter(Boolean)
  });
}

function runGate(outputDir, name, command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env: process.env });
  const log = [
    `$ ${command} ${args.join(' ')}`,
    result.stdout || '',
    result.stderr || '',
    `exit_code=${result.status}`
  ].join('\n');
  const file = path.join(outputDir, `${name}.log`);
  fs.writeFileSync(file, log);
  if (result.status !== 0) throw new Error(`${name} gate failed; see ${file}`);
  return { command: `${command} ${args.join(' ')}`, status: 'pass', path: file, sha256: digest(log) };
}

function runSyntaxGate(outputDir) {
  const files = git('ls-files', '*.js').split('\n').filter(Boolean);
  const lines = [];
  for (const file of files) {
    execute(process.execPath, ['--check', file]);
    lines.push(file);
  }
  const log = `${lines.join('\n')}\nchecked=${lines.length}\nexit_code=0\n`;
  const file = path.join(outputDir, 'syntax.log');
  fs.writeFileSync(file, log);
  return { command: 'node --check <all tracked js>', status: 'pass', path: file, sha256: digest(log) };
}

function runFullJestGate(outputDir) {
  const resultPath = path.join(outputDir, 'full-jest-results.json');
  const args = ['test', '--', '--runInBand', '--json', `--outputFile=${resultPath}`];
  const result = spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8', env: process.env });
  const log = [`$ npm ${args.join(' ')}`, result.stdout || '', result.stderr || '',
    `exit_code=${result.status}`].join('\n');
  const file = path.join(outputDir, 'full.log');
  fs.writeFileSync(file, log);
  if (result.status !== 0) throw new Error(`full gate failed; see ${file}`);
  const report = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults.map((assertion) => ({
    file: path.relative(ROOT, suite.name),
    full_name: assertion.fullName,
    status: assertion.status
  })));
  return {
    command: `npm ${args.join(' ')}`,
    status: 'pass',
    path: file,
    sha256: digest(log),
    result_path: resultPath,
    result_sha256: digest(fs.readFileSync(resultPath)),
    suites: { pass: report.numPassedTestSuites, total: report.numTotalTestSuites },
    tests: { pass: report.numPassedTests, total: report.numTotalTests },
    assertions
  };
}

function runGates(outputDir) {
  const publish = runGate(outputDir, 'publish', 'npm', ['run', 'verify:publish']);
  const executors = new Map(Object.entries(EXECUTOR_TESTS).map(([issue, files]) => [
    Number(issue),
    {
      issue: Number(issue),
      test_files: files,
      ...runGate(outputDir, `executor-${issue}`, 'npx', ['jest', ...files, '--runInBand'])
    }
  ]));
  const gates = [
    publish,
    ...executors.values(),
    runFullJestGate(outputDir),
    runGate(outputDir, 'diff', 'git', ['diff', '--check', `${TARGET}...HEAD`]),
    runSyntaxGate(outputDir)
  ];
  return { gates, executors };
}

function wait(milliseconds) {
  const state = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(state, 0, 0, milliseconds);
}

function readJsonWithRetry({ resource, read, attempts = 4, pause = wait }) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return JSON.parse(read(resource));
    } catch (error) {
      failure = error;
      if (attempt < attempts) pause(250 * (2 ** (attempt - 1)));
    }
  }
  throw new Error(`${resource} read failed after ${attempts} attempts: ${failure.message}`);
}

function gh(endpoint) {
  return readJsonWithRetry({
    resource: endpoint,
    read: (resource) => execute('gh', ['api', resource])
  });
}

function trackerSnapshot() {
  const issues = [];
  const ownership = [];
  const issueNumbers = [...Array.from({ length: 16 }, (_, index) => 65 + index), 82, 84, 87, 88];
  const closed = new Set([...Array.from({ length: 16 }, (_, index) => 65 + index), 82, 84, 88]);
  for (const issue of issueNumbers) {
    const record = gh(`repos/${REPO}/issues/${issue}`);
    const blockedBy = gh(`repos/${REPO}/issues/${issue}/dependencies/blocked_by`)
      .map((blocker) => blocker.number).sort((left, right) => left - right);
    const expectedState = closed.has(issue) ? 'closed' : 'open';
    if (record.state !== expectedState) {
      throw new Error(`#${issue} state must remain ${expectedState} during #87 simplification`);
    }
    const owners = [82, 84, 87, 88].includes(issue) ? [] : parsePrimaryOwners(record.body);
    issues.push({
      issue,
      url: record.html_url,
      state: record.state,
      updated_at: record.updated_at,
      body_sha256: digest(record.body),
      primary_acceptance_ids: owners,
      blocked_by: blockedBy
    });
    ownership.push(...owners.map((acceptanceId) => ({
      acceptance_id: acceptanceId,
      primary_issue: issue,
      source: record.html_url
    })));
  }
  const audit = auditPrimaryOwnership(catalog, ownership);
  if (!audit.success) throw new Error(audit.error);
  return { issues, ownership, audit };
}

function integrationEvidence(history) {
  return Object.entries(COMMENT_IDS).map(([issue, commentId]) => {
    const comment = gh(`repos/${REPO}/issues/comments/${commentId}`);
    const commits = history.filter(([owner]) => owner === issue)
      .map(([, commit]) => commit).slice(-1);
    if (commits.some((commit) => !comment.body.includes(commit))) {
      throw new Error(`#${issue} durable integration evidence does not bind all expected commits`);
    }
    return {
      issue: Number(issue),
      url: comment.html_url,
      updated_at: comment.updated_at,
      body_sha256: digest(comment.body),
      commits
    };
  });
}

function packOnce(destination, env) {
  const output = execute('npm', ['pack', '--json', '--pack-destination', destination], { env });
  return JSON.parse(output)[0];
}

function unpackedInventory(tarball, metadata, destination, env) {
  execute('tar', ['-xzf', tarball, '-C', destination], { env });
  return metadata.files.map((entry) => {
    const content = fs.readFileSync(path.join(destination, 'package', entry.path));
    return { ...entry, sha256: digest(content) };
  });
}

function toolVersions(env) {
  return {
    node: process.version,
    npm: execute('npm', ['--version'], { env }).trim(),
    git: execute('git', ['--version'], { env }).trim(),
    tar: execute('tar', ['--version'], { env }).split('\n')[0].trim(),
    gh: execute('gh', ['--version'], { env }).split('\n')[0].trim()
  };
}

function freezeArtifact(outputDir, head, { env = process.env } = {}) {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-pack-1-'));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-pack-2-'));
  const unpack = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-unpack-'));
  try {
    const one = packOnce(first, env);
    const two = packOnce(second, env);
    const firstPath = path.join(first, one.filename);
    const secondPath = path.join(second, two.filename);
    const bytes = fs.readFileSync(firstPath);
    const repack = fs.readFileSync(secondPath);
    const sha512 = digest(bytes, 'sha512');
    const integrity = `sha512-${digest(bytes, 'sha512', 'base64')}`;
    const artifactPath = path.join(outputDir, one.filename);
    fs.copyFileSync(firstPath, artifactPath, fs.constants.COPYFILE_EXCL);
    const record = {
      source_commit: head,
      source_clean: true,
      artifact_paths: [artifactPath],
      name: one.filename,
      size: bytes.length,
      sha512,
      npm_integrity: integrity,
      npm_shasum: one.shasum,
      inventory: unpackedInventory(firstPath, one, unpack, env),
      repack: {
        sha512: digest(repack, 'sha512'),
        npm_integrity: `sha512-${digest(repack, 'sha512', 'base64')}`,
        byte_identical: bytes.equals(repack)
      },
      procedure: [
        'npm pack --json --pack-destination <isolated-temp-1>',
        'npm pack --json --pack-destination <isolated-temp-2>',
        'compare complete tarball bytes before preserving the sole final artifact'
      ],
      tools: toolVersions(env)
    };
    const audit = auditArtifactFreeze(record);
    if (!audit.success || !record.repack.byte_identical || one.integrity !== integrity
      || two.integrity !== integrity) throw new Error(audit.error || 'npm pack integrity drift');
    return { record, audit };
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
    fs.rmSync(unpack, { recursive: true, force: true });
  }
}

function gitFile(ref, rel) {
  return Buffer.from(execute('git', ['show', `${ref}:${rel}`], { encoding: null }));
}

function hostCarryEvidence(artifact, outputDir) {
  const inventory = new Map(artifact.record.inventory.map((entry) => [entry.path, entry.sha256]));
  return Object.fromEntries(Object.entries(HOST_CARRY).map(([acceptanceId, config]) => {
    const comment = gh(`repos/${REPO}/issues/comments/${config.comment_id}`);
    const current = fs.readFileSync(path.join(ROOT, config.skill_path));
    const version = execute(config.executable, ['--version']).trim();
    const proof = {
      acceptance_id: acceptanceId,
      evidence_url: comment.html_url,
      evidence_body_sha256: digest(comment.body),
      evidence_updated_at: comment.updated_at,
      evaluated_at: new Date().toISOString(),
      evidence_head: config.evidence_head,
      frozen_head: artifact.record.source_commit,
      skill_path: config.skill_path,
      skill_sha256: digest(current),
      artifact_path_sha256: inventory.get(config.skill_path),
      host: config.host,
      current_version: version,
      evidence_head_ancestor: spawnSync('git', [
        'merge-base', '--is-ancestor', config.evidence_head, artifact.record.source_commit
      ], { cwd: ROOT }).status === 0,
      skill_bytes_identical: gitFile(config.evidence_head, config.skill_path).equals(current),
      artifact_digest_match: inventory.get(config.skill_path) === digest(current),
      host_version_unchanged: version.includes(config.version)
    };
    const file = path.join(outputDir, `${acceptanceId.toLowerCase()}-carry-forward.json`);
    const sha256 = writeJson(file, proof);
    return [acceptanceId, { proof, file, sha256 }];
  }));
}

function evidenceRef(kind, uri, sha256) {
  return { kind, uri, sha256 };
}

function resultFor(row, context) {
  const issue = context.ownerById.get(row.acceptance_id);
  const issueEvidence = context.issueByNumber.get(issue);
  const integration = context.integrationByIssue.get(issue);
  const carry = context.hostCarry[row.acceptance_id];
  const expected = expectedPreReleaseOutcome(row);
  const carryPass = expected === 'host-carry' && Object.values(carry.proof)
    .filter((value) => typeof value === 'boolean').every(Boolean);
  const outcome = expected === 'pass' || carryPass ? 'pass' : 'pending';
  const ownerEvidence = integration || (issue === 78 ? {
    url: context.artifactFile,
    body_sha256: context.artifactFileSha256,
    commits: [context.head]
  } : null);
  let rowExecutor = null;
  if (outcome === 'pass') {
    const declared = row.executor?.assertions || [];
    const matches = declared.map((coordinate) => {
      const assertions = context.fullGate.assertions.filter((assertion) => (
        assertion.file === coordinate.file && assertion.full_name === coordinate.full_name
      ));
      if (!assertions.length || assertions.some((assertion) => assertion.status !== 'passed')) {
        throw new Error(`Canonical executor did not pass for ${row.acceptance_id}: ${coordinate.full_name}`);
      }
      return { ...coordinate, matched: assertions.length, status: 'passed' };
    });
    if (expected !== 'host-carry' && !matches.length) {
      throw new Error(`Canonical executor is missing for ${row.acceptance_id}`);
    }
    const record = {
      schema_version: 1,
      acceptance_id: row.acceptance_id,
      primary_issue: issue,
      status: 'pass',
      runner: matches.length ? 'jest' : 'host-carry-forward',
      command: matches.length ? context.fullGate.command : null,
      assertions: matches,
      gate_log: matches.length ? context.fullGate.path : carry.file,
      gate_log_sha256: matches.length ? context.fullGate.sha256 : carry.sha256,
      catalog_procedure_sha256: digest(row.procedure),
      catalog_pass_condition_sha256: digest(row.pass_condition),
      source_commit: context.head
    };
    const file = path.join(context.executorDir, `${row.acceptance_id}.json`);
    rowExecutor = { record, file, sha256: writeJson(file, record) };
  }
  const executor = {
    primary_issue: issue,
    owner_evidence_verified: Boolean(ownerEvidence),
    integrated_commit_ancestor: Boolean(ownerEvidence?.commits.every((commit) => (
      spawnSync('git', ['merge-base', '--is-ancestor', commit, context.head], { cwd: ROOT }).status === 0
    ))),
    current_full_gate_pass: context.fullGate.status === 'pass',
    current_publish_gate_pass: context.publishGate.status === 'pass',
    row_executor_pass: rowExecutor?.record.status === 'pass',
    predicate_bound: Boolean(rowExecutor?.record.catalog_procedure_sha256
      && rowExecutor?.record.catalog_pass_condition_sha256
      && (rowExecutor?.record.assertions.length || carryPass))
  };
  const evidence = [
    evidenceRef('full-local-gate', context.fullGate.path, context.fullGate.sha256),
    evidenceRef('publish-gate', context.publishGate.path, context.publishGate.sha256),
    evidenceRef('tracker-primary-owner', issueEvidence.url, issueEvidence.body_sha256),
    evidenceRef('artifact-freeze', context.artifactFile, context.artifactFileSha256)
  ];
  if (integration) evidence.push(evidenceRef('durable-integration', integration.url, integration.body_sha256));
  if (rowExecutor) evidence.push(evidenceRef('executor-result', rowExecutor.file, rowExecutor.sha256));
  if (carry) evidence.push(evidenceRef('host-carry-forward', carry.file, carry.sha256));
  return {
    acceptance_id: row.acceptance_id,
    outcome,
    started_at: outcome === 'pass' ? context.startedAt : null,
    finished_at: outcome === 'pass' ? context.finishedAt : null,
    freshness: {
      source_commit: context.head,
      artifact_sha512: context.artifact.record.sha512,
      catalog_id_set_sha256: catalog.id_set_sha256,
      executor,
      ...(carry ? { host_carry_forward: carry.proof } : {}),
      ...(outcome === 'pending' ? { live_gate: 'not-executed' } : {})
    },
    authority: {
      primary_owner_issue: issue,
      catalog_mutation_authority: row.mutation_authority,
      user_authority: [79, 80].includes(issue) ? 'explicit-stop' : 'not-granted',
      remote_actions_performed: 'none'
    },
    evidence_refs: evidence,
    mutation: {
      before_gate: null,
      requested: [],
      performed: [],
      readback: [],
      rollback_or_fix_forward_boundary: null
    }
  };
}

function acceptancePacket(context) {
  const ownerById = new Map(context.tracker.ownership
    .map((row) => [row.acceptance_id, row.primary_issue]));
  const issueByNumber = new Map(context.tracker.issues.map((issue) => [issue.issue, issue]));
  const integrationByIssue = new Map(context.integration.map((item) => [item.issue, item]));
  const results = catalog.rows.map((row) => resultFor(row, {
    ...context, ownerById, issueByNumber, integrationByIssue
  }));
  const packet = generateAcceptancePacket({
    catalog,
    metadata: {
      run_id: `issue-78-${context.head.slice(0, 12)}`,
      created_at: context.finishedAt,
      repo: REPO,
      source_commit: context.head,
      artifact: {
        name: context.artifact.record.name,
        sha512: context.artifact.record.sha512,
        npm_integrity: context.artifact.record.npm_integrity
      },
      environment: {
        node: context.artifact.record.tools.node,
        npm: context.artifact.record.tools.npm,
        os: `${process.platform}-${process.arch}`,
        host_versions: Object.fromEntries(Object.values(context.hostCarry)
          .map(({ proof }) => [proof.host, proof.current_version]))
      }
    },
    results
  });
  if (!packet.success) throw new Error(packet.error);
  const audit = auditPreReleasePacket({
    catalog,
    packet: packet.data,
    ownership: context.tracker.ownership
  });
  if (!audit.success) throw new Error(audit.error);
  return { packet: packet.data, audit };
}

function releaseHandoff(context) {
  const { integration } = context.provenance;
  const { base, branch, commits: ahead, delivered_issues: integratedIssues } = integration;
  const touched = git('diff', '--name-only', `${TARGET}...HEAD`).split('\n').filter(Boolean).sort();
  return {
    source: branch,
    target: TARGET,
    base,
    head: context.head,
    ahead_commits: ahead,
    scope_source: { kind: 'wayfinder', url: `https://github.com/${REPO}/issues/56` },
    spec: `https://github.com/${REPO}/issues/64`,
    issues: integratedIssues.map((issue) => `https://github.com/${REPO}/issues/${issue}`),
    checks: context.gates.map(({ command, status }) => ({ command, status })),
    local_review: { status: 'pass', base, head: context.head },
    touched_paths: touched,
    risks: [
      `${context.packetAudit.live.pending} live acceptance rows remain pending`,
      'any source change invalidates C/A and requires a new freeze',
      '#79 and #80 remain explicit user-authority stops'
    ],
    closeout_intent: integratedIssues.map((issue) => ({
      issue: `#${issue}`,
      action: 'close-after-merge'
    })),
    remote_actions_performed: 'none',
    release_readiness: {
      provider: 'github',
      repo: REPO,
      remote: 'origin',
      target: TARGET,
      integration_branch: branch,
      parent_thread: SOURCE_THREAD,
      worktree: WORKTREE,
      source_clean: true,
      dispatch_base: base,
      artifact: {
        path: context.artifact.record.artifact_paths[0],
        source_commit: context.head,
        sha512: context.artifact.record.sha512,
        npm_integrity: context.artifact.record.npm_integrity
      },
      acceptance_packet: {
        path: context.packetPath,
        sha256: context.packetSha256
      },
      diff: {
        base,
        head: context.head,
        touched_paths_sha256: textSetSha256(touched)
      },
      ticket_review: {
        status: 'pass', base, head: context.head, axes: ['Standards', 'Spec']
      },
      readiness_verdict: 'blocked-pending-live',
      next_owner: 'Dverity',
      next_action: 'submit-remote-review'
    }
  };
}

function main() {
  const startedAt = new Date().toISOString();
  REPO = repositoryCoordinate();
  execute('git', ['fetch', '--prune', 'origin']);
  const fetchedTarget = git('rev-parse', TARGET);
  const provenance = assertCleanHead();
  const { head, commits: history, history: currentHistory } = provenance.integration;
  const outputDir = path.join(ROOT, 'dist', 'release-readiness', head);
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.mkdirSync(outputDir);
  const tracker = trackerSnapshot();
  const dagAudit = auditDependencyOrder(tracker.issues, currentHistory);
  if (!dagAudit.success || tracker.issues.length !== 20 || dagAudit.edges !== 27) {
    throw new Error(dagAudit.error || `native dependency edge drift: ${dagAudit.edges}`);
  }
  const integration = integrationEvidence(currentHistory);
  const executorDir = path.join(outputDir, 'executors');
  fs.mkdirSync(executorDir);
  const gateBundle = runGates(outputDir);
  const { gates } = gateBundle;
  const artifact = freezeArtifact(outputDir, head);
  const artifactFile = path.join(outputDir, 'artifact-freeze.json');
  const artifactFileSha256 = writeJson(artifactFile, artifact.record);
  const hostCarry = hostCarryEvidence(artifact, outputDir);
  const finishedAt = new Date().toISOString();
  const packetResult = acceptancePacket({
    head, tracker, integration, gates, artifact, artifactFile, artifactFileSha256,
    hostCarry, startedAt, finishedAt, executorDir,
    fullGate: gates.find((gate) => gate.path.endsWith('/full.log')),
    publishGate: gates.find((gate) => gate.path.endsWith('/publish.log'))
  });
  const packetPath = path.join(outputDir, 'dverity-acceptance-packet.json');
  const packetSha256 = writeJson(packetPath, packetResult.packet);
  const handoff = releaseHandoff({
    head, gates, artifact, packetAudit: packetResult.audit, packetPath, packetSha256,
    provenance
  });
  const handoffAudit = validateReleaseHandoff({
    handoff,
    dispatchBase: provenance.integration.base,
    artifact: artifact.record,
    packetSha256,
    expectedIntegratedIssues: provenance.integration.delivered_issues
  });
  if (!handoffAudit.success) throw new Error(handoffAudit.error);
  const handoffPath = path.join(outputDir, 'wayfinder-submit-handoff.json');
  const handoffSha256 = writeJson(handoffPath, handoff);
  const manifest = {
    schema_version: 1,
    issue: `https://github.com/${REPO}/issues/87`,
    thread: SOURCE_THREAD,
    worktree: WORKTREE,
    branch: provenance.integration.branch,
    base: provenance.integration.base,
    head,
    ahead_commits: history,
    integration_history: currentHistory.map(([issue, commit]) => ({ issue: Number(issue), commit })),
    remote_readback: { repo: REPO, target: TARGET, head: fetchedTarget, fetched_at: startedAt },
    dag_audit: dagAudit,
    tracker_audit: tracker.audit,
    artifact: { ...artifact.audit.artifact, metadata_path: artifactFile, metadata_sha256: artifactFileSha256 },
    packet: { path: packetPath, sha256: packetSha256, ...packetResult.audit },
    handoff: { path: handoffPath, sha256: handoffSha256, audit: 'pass' },
    host_carry_forward: Object.fromEntries(Object.entries(hostCarry).map(([id, value]) => [id, value.proof])),
    checks: gates,
    reviews: {
      ticket: { base: provenance.integration.base, head, axes: ['Standards', 'Spec'], status: 'pass' },
      integration: { base: provenance.integration.base, head, axes: ['Standards', 'Spec'], status: 'pass' }
    },
    remote_actions_performed: 'none',
    next_owner: 'Dverity',
    next_action: 'submit-remote-review'
  };
  const manifestPath = path.join(outputDir, 'readiness-manifest.json');
  writeJson(manifestPath, manifest);
  if (git('status', '--porcelain=v1', '--untracked-files=all')) {
    throw new Error('release freeze left the worktree dirty');
  }
  process.stdout.write(json({ output_dir: outputDir, artifact: manifest.artifact, packet: manifest.packet,
    handoff: manifest.handoff, remote_actions_performed: 'none' }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  freezeArtifact,
  readJsonWithRetry
};
