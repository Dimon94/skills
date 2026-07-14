const catalog = require('../../../../acceptance/catalog.json');
const { generateAcceptancePacket } = require('../../../acceptance/ledger');
const {
  auditArtifactFreeze,
  auditDependencyOrder,
  auditProviderMerge,
  auditPrimaryOwnership,
  auditPreReleasePacket,
  expectedPreReleaseOutcome,
  parsePrimaryOwners,
  validateReleaseHandoff
} = require('../../release/release-readiness');
const {
  INTEGRATION_BRANCH,
  RELEASE_REVIEW_BASE,
  VERIFIED_REMOTE_MAIN_BASE,
  VERIFIED_REMOTE_MAIN_PR,
  assertReleaseFreezeHistory,
  integratedHistory,
  readJsonWithRetry
} = require('../../../../scripts/freeze-release-readiness');

const VERIFIED_REMOTE_MAIN = '2e468ffca1a45a0481ccf2f7e72b6d2a489951ec';
const VERIFIED_REMOTE_MAIN_BASE_VALUE = 'b6adff9f1731c39b5c23a22d716b40094c278581';
const ORIGINAL_FROZEN = '953deb4514dc6ad6f882943eaa79dd098b2bab20';
const ISSUE_78_FROZEN = 'c4c43027b060645cdb1d5cfb5b49828dc09a74a2';
const ISSUE_82_SOURCE = 'cb31ad83c2ec1e6eb0a90fbd0ff0b32e4fca30b2';

const REPAIRS = [
  '71a5231de2cc8d3a6629191862db191860bb9c05',
  'b1c03228f81723f56ed05a0213a57c39bb564a21',
  '2f70fe4516644d5eb0572a4acbe462d992c3703a'
];

function repairedFreeze(change = {}) {
  return {
    branch: INTEGRATION_BRANCH,
    dirty: '',
    head: REPAIRS.at(-1),
    target: VERIFIED_REMOTE_MAIN,
    targetOnly: 0,
    headOnly: REPAIRS.length,
    history: REPAIRS,
    verifiedParents: [VERIFIED_REMOTE_MAIN_BASE_VALUE, ORIGINAL_FROZEN],
    verifiedTree: '2'.repeat(40),
    originalFrozenTree: '2'.repeat(40),
    repairLines: REPAIRS.map((commit, index) => (
      `${commit} ${index ? REPAIRS[index - 1] : VERIFIED_REMOTE_MAIN}`
    )),
    ...change
  };
}

describe('Dverity repaired release freeze provenance', () => {
  test('binds the generator to the #84 refreeze branch and landed review base', () => {
    expect(INTEGRATION_BRANCH).toBe('codex/dverity-84-refreeze');
    expect(RELEASE_REVIEW_BASE).toBe(VERIFIED_REMOTE_MAIN);
    expect(VERIFIED_REMOTE_MAIN_BASE).toBe(VERIFIED_REMOTE_MAIN_BASE_VALUE);
    expect(VERIFIED_REMOTE_MAIN_PR).toBe(85);
    expect(() => assertReleaseFreezeHistory(repairedFreeze({ branch: 'codex/dverity-84-publish-bootstrap' })))
      .toThrow(/integration branch/i);
  });
  test('accepts the clean linear review-repair descendants of the original frozen commit', () => {
    expect(assertReleaseFreezeHistory(repairedFreeze())).toEqual({
      head: REPAIRS.at(-1),
      head: REPAIRS.at(-1), history: REPAIRS
    });
  });

  test.each([
    ['dirty worktree', { dirty: ' M package.json' }],
    ['target moved', { targetOnly: 1 }],
    ['target moved', { target: 'f'.repeat(40) }],
    ['missing verified-main parent', { verifiedParents: ['1'.repeat(40)] }],
    ['wrong frozen tree', { originalFrozenTree: '3'.repeat(40) }],
    ['side branch merge', {
      repairLines: [
        `${REPAIRS[0]} ${VERIFIED_REMOTE_MAIN}`,
        `${REPAIRS[1]} ${REPAIRS[0]} side`,
        `${REPAIRS[2]} ${REPAIRS[1]}`
      ]
    }],
    ['stale checkpoint', {
      head: VERIFIED_REMOTE_MAIN,
      headOnly: 0,
      history: [],
      repairLines: []
    }]
  ])('rejects fail-open repaired freeze evidence: %s', (_name, change) => {
    expect(() => assertReleaseFreezeHistory(repairedFreeze(change))).toThrow();
  });
});

describe('Dverity provider-bound #84 landing checkpoint', () => {
  function checkpoint(change = {}) {
    return {
      repository: 'Dimon94/dverity',
      pullNumber: 85,
      merge: VERIFIED_REMOTE_MAIN,
      expectedBase: VERIFIED_REMOTE_MAIN_BASE_VALUE,
      expectedHead: ORIGINAL_FROZEN,
      parents: [VERIFIED_REMOTE_MAIN_BASE_VALUE, ORIGINAL_FROZEN],
      mergeTree: 'a'.repeat(40),
      sourceTree: 'a'.repeat(40),
      pull: {
        number: 85,
        merged_at: '2026-07-14T03:18:22Z',
        merge_commit_sha: VERIFIED_REMOTE_MAIN,
        base: {
          ref: 'main', sha: VERIFIED_REMOTE_MAIN_BASE_VALUE,
          repo: { full_name: 'Dimon94/dverity' }
        },
        head: { sha: ORIGINAL_FROZEN }
      },
      ...change
    };
  }

  test('accepts the authenticated exact PR #85 merge and tree parity', () => {
    expect(auditProviderMerge(checkpoint())).toEqual({
      success: true,
      data: {
        pull: 85,
        merge: VERIFIED_REMOTE_MAIN,
        base: VERIFIED_REMOTE_MAIN_BASE_VALUE,
        source: ORIGINAL_FROZEN
      }
    });
  });

  test.each([
    ['wrong parent order', { parents: [ORIGINAL_FROZEN, VERIFIED_REMOTE_MAIN_BASE_VALUE] }],
    ['squash merge', { parents: [VERIFIED_REMOTE_MAIN_BASE_VALUE] }],
    ['octopus merge', { parents: [VERIFIED_REMOTE_MAIN_BASE_VALUE, ORIGINAL_FROZEN, 'f'.repeat(40)] }],
    ['tree mismatch', { sourceTree: 'b'.repeat(40) }],
    ['PR mismatch', { pull: { number: 84 } }]
  ])('rejects false provider checkpoint evidence: %s', (_name, change) => {
    expect(auditProviderMerge(checkpoint(change))).toEqual({
      success: false,
      error: expect.any(String)
    });
  });
});

describe('Dverity explicit integrated issue set', () => {
  test('builds the exact canonical integrated set with #78, #82, then #84', () => {
    const history = integratedHistory('f'.repeat(40));
    expect([...new Set(history.map(([issue]) => Number(issue)))]).toEqual([
      65, 66, 67, 71, 68, 69, 72, 70, 75, 73, 74, 76, 77, 78, 82, 84
    ]);
    expect(history.slice(-3)).toEqual([
      ['78', ISSUE_78_FROZEN],
      ['82', ISSUE_82_SOURCE],
      ['84', 'f'.repeat(40)]
    ]);
  });

  test('accepts #84 integrated while #79 and #80 remain pending', () => {
    const blockers = new Map([
      [65, []], [66, [65]], [67, [66]], [68, [66]], [69, [67, 68]], [70, [69]],
      [71, [66]], [72, [71]], [73, [72]], [74, [67, 73]], [75, [72]],
      [76, [70, 74, 75]], [77, [76]], [78, [70, 74, 75, 77]],
      [79, [78, 82, 84]], [80, [79]], [82, []], [84, []]
    ]);
    const issues = [...blockers].map(([issue, blocked_by]) => ({ issue, blocked_by }));
    const history = integratedHistory('f'.repeat(40));
    const expected = new Set([...Array.from({ length: 14 }, (_, i) => 65 + i), 82, 84]);
    const audit = auditDependencyOrder(issues, history, expected);

    expect(audit).toEqual({
      success: true,
      edges: 24,
      cycles: [],
      integrated_issues: [...expected].sort((left, right) => left - right)
    });
    expect(auditDependencyOrder(issues, history.filter(([issue]) => issue !== '78'), expected).success)
      .toBe(false);
  });
});

const BASE = 'a'.repeat(40);
const DISPATCH_BASE = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const SHA512 = 'd'.repeat(128);
const INTEGRITY = `sha512-${Buffer.from('dverity').toString('base64')}`;

describe('Dverity release artifact freeze', () => {
  test('accepts one clean artifact whose independent repack is byte-identical', () => {
    expect(auditArtifactFreeze(artifactFreeze())).toEqual({
      success: true,
      artifact: expect.objectContaining({
        source_commit: HEAD,
        sha512: SHA512,
        npm_integrity: INTEGRITY,
        inventory_count: 2,
        repack_byte_identical: true
      })
    });
  });

  test.each([
    ['dirty source', { source_clean: false }],
    ['two artifact paths', { artifact_paths: ['a.tgz', 'b.tgz'] }],
    ['repack drift', { repack: { sha512: 'e'.repeat(128), npm_integrity: INTEGRITY } }],
    ['duplicate inventory', { inventory: [{ path: 'package.json', size: 1, mode: 420 }, { path: 'package.json', size: 1, mode: 420 }] }],
    ['incomplete inventory', { inventory: [{ path: 'package.json', size: 1, mode: 420 }] }],
    ['missing tool version', { tools: { node: 'v22.0.0', npm: '', git: '2.52.0', tar: '3.5.3' } }]
  ])('rejects false-green artifact evidence: %s', (_name, change) => {
    expect(auditArtifactFreeze({ ...artifactFreeze(), ...change })).toEqual({
      success: false,
      error: expect.any(String)
    });
  });
});

describe('Dverity release provider read', () => {
  test('retries transient provider failures before accepting fresh JSON', () => {
    const read = jest.fn()
      .mockImplementationOnce(() => { throw new Error('EOF'); })
      .mockImplementationOnce(() => '{')
      .mockReturnValue('{"fresh":true}');
    const pause = jest.fn();

    expect(readJsonWithRetry({ resource: 'issues/78', read, pause })).toEqual({ fresh: true });
    expect(read).toHaveBeenCalledTimes(3);
    expect(pause.mock.calls).toEqual([[250], [500]]);
  });

  test('fails closed after the bounded provider retry budget is exhausted', () => {
    const read = jest.fn(() => { throw new Error('EOF'); });
    const pause = jest.fn();

    expect(() => readJsonWithRetry({ resource: 'issues/78', read, attempts: 3, pause }))
      .toThrow('issues/78 read failed after 3 attempts: EOF');
    expect(read).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenCalledTimes(2);
  });
});

describe('Dverity 55-ID pre-release packet', () => {
  test('parses primary ownership only from the tracker contract line', () => {
    expect(parsePrimaryOwners([
      'Primary acceptance owner: `DV-SRC-001`, `DV-SRC-002`',
      'Referenced, not owned here: `DV-DWN-002`'
    ].join('\n'))).toEqual(['DV-SRC-001', 'DV-SRC-002']);
    expect(() => parsePrimaryOwners('no ownership line')).toThrow(/primary acceptance owner/i);
  });

  test('classifies local, host carry, and unexecuted live rows without a second ID list', () => {
    expect(expectedPreReleaseOutcome({ acceptance_id: 'DV-SRC-001', execution_class: 'CI/NI' }))
      .toBe('pass');
    expect(expectedPreReleaseOutcome({ acceptance_id: 'DV-INS-002', execution_class: 'LIVE' }))
      .toBe('host-carry');
    expect(expectedPreReleaseOutcome({ acceptance_id: 'DV-REL-002', execution_class: 'LIVE' }))
      .toBe('pending');
  });

  test('proves canonical count, exact-once primary ownership, local PASS, and honest live pending', () => {
    const ownership = primaryOwnership();
    const packet = acceptancePacket(ownership);

    expect(auditPrimaryOwnership(catalog, ownership)).toEqual({
      success: true,
      canonical: 55,
      entries: 55,
      unique: 55,
      missing: [],
      duplicates: [],
      unexpected: []
    });
    expect(auditPreReleasePacket({ catalog, packet, ownership })).toEqual({
      success: true,
      canonical: 55,
      entries: 55,
      unique: 55,
      missing: [],
      duplicates: [],
      unexpected: [],
      local: { required: 38, pass: 38 },
      live: { pending: 17, carried: 2 },
      rollup: { pass: 38, fail: 0, blocked: 0, unknown: 0, pending: 17 },
      verdict: 'blocked-pending-live'
    });
  });

  test('rejects duplicate, missing, and unexpected primary owners', () => {
    const ownership = primaryOwnership();
    for (const invalid of [
      [...ownership, ownership[0]],
      ownership.slice(1),
      [{ acceptance_id: 'DV-EXTRA-001', primary_issue: 78 }, ...ownership.slice(1)]
    ]) {
      expect(auditPrimaryOwnership(catalog, invalid).success).toBe(false);
    }
  });

  test('rejects a non-PASS local row', () => {
    const ownership = primaryOwnership();
    const packet = acceptancePacket(ownership);
    packet.results.find((row) => row.acceptance_id === 'DV-SRC-001').outcome = 'pending';
    packet.rollup = rollup(packet.results);

    expect(auditPreReleasePacket({ catalog, packet, ownership })).toEqual({
      success: false,
      error: expect.stringMatching(/local.*pass/i)
    });
  });

  test('rejects a local PASS without row-bound executor evidence', () => {
    const ownership = primaryOwnership();
    const packet = acceptancePacket(ownership);
    const row = packet.results.find((result) => result.acceptance_id === 'DV-SRC-001');
    delete row.freshness.executor;
    row.evidence_refs = row.evidence_refs.map((ref) => ({ ...ref, kind: 'shared-log' }));

    expect(auditPreReleasePacket({ catalog, packet, ownership })).toEqual({
      success: false,
      error: expect.stringMatching(/row-bound executor evidence/i)
    });
  });

  test('rejects a live PASS without current live or carry-forward evidence', () => {
    const ownership = primaryOwnership();
    const packet = acceptancePacket(ownership);
    const row = packet.results.find((result) => result.acceptance_id === 'DV-REM-001');
    Object.assign(row, terminalResult(row.acceptance_id, 70));
    packet.rollup = rollup(packet.results);

    expect(auditPreReleasePacket({ catalog, packet, ownership })).toEqual({
      success: false,
      error: expect.stringMatching(/live.*pending|carry-forward/i)
    });
  });

  test('rejects truthy but untyped host carry-forward evidence', () => {
    const ownership = primaryOwnership();
    const packet = acceptancePacket(ownership);
    packet.results.find((row) => row.acceptance_id === 'DV-INS-002')
      .freshness.host_carry_forward = { a: 'yes', b: 'yes', c: 'yes', d: 'yes' };

    expect(auditPreReleasePacket({ catalog, packet, ownership })).toEqual({
      success: false,
      error: expect.stringMatching(/carry-forward/i)
    });
  });

  test('requires freshness, authority, and evidence refs on pending rows', () => {
    const ownership = primaryOwnership();
    const packet = acceptancePacket(ownership);
    const pending = packet.results.find((row) => row.acceptance_id === 'DV-REL-002');
    pending.freshness = {};
    pending.authority = {};
    pending.evidence_refs = [];

    expect(auditPreReleasePacket({ catalog, packet, ownership })).toEqual({
      success: false,
      error: expect.stringMatching(/pending.*freshness.*authority.*evidence/i)
    });
  });

  test('validates fresh native blocker edges against the integrated commit order', () => {
    const issues = [
      { issue: 65, blocked_by: [] },
      { issue: 66, blocked_by: [65] },
      { issue: 67, blocked_by: [66] },
      { issue: 78, blocked_by: [67] }
    ];
    const history = [[65, 'a'], [66, 'b'], [67, 'c'], [78, 'd']];

    expect(auditDependencyOrder(issues, history)).toEqual({
      success: true,
      edges: 3,
      cycles: [],
      integrated_issues: [65, 66, 67, 78]
    });
    expect(auditDependencyOrder(
      issues.map((entry) => entry.issue === 66 ? { ...entry, blocked_by: [67] } : entry),
      history
    )).toEqual({ success: false, error: expect.stringMatching(/dependency order|cycle/i) });
  });

  test.each([79, 80])('keeps explicit user-authority stop #%s pending', (issue) => {
    const ownership = primaryOwnership();
    const packet = acceptancePacket(ownership);
    const owned = new Set(ownership.filter((row) => row.primary_issue === issue)
      .map((row) => row.acceptance_id));
    const row = packet.results.find((result) => owned.has(result.acceptance_id));
    Object.assign(row, terminalResult(row.acceptance_id, issue));
    packet.rollup = rollup(packet.results);

    expect(auditPreReleasePacket({ catalog, packet, ownership })).toEqual({
      success: false,
      error: expect.stringMatching(/user-authority stop/i)
    });
  });
});

describe('Wayfinder to Submit release handoff', () => {
  test('accepts a clean-but-ahead integration handoff bound to C and A', () => {
    expect(validateReleaseHandoff({
      handoff: releaseHandoff(),
      dispatchBase: DISPATCH_BASE,
      artifact: artifactFreeze(),
      packetSha256: 'e'.repeat(64),
      expectedIntegratedIssues: [78]
    })).toEqual({ success: true, data: expect.objectContaining({ head: HEAD }) });
  });

  test.each([
    ['no ahead commits', (handoff) => { handoff.ahead_commits = []; }],
    ['dirty source', (handoff) => { handoff.release_readiness.source_clean = false; }],
    ['wrong ticket review base', (handoff) => { handoff.release_readiness.ticket_review.base = BASE; }],
    ['artifact drift', (handoff) => { handoff.release_readiness.artifact.sha512 = 'f'.repeat(128); }],
    ['packet drift', (handoff) => { handoff.release_readiness.acceptance_packet.sha256 = 'f'.repeat(64); }],
    ['remote mutation', (handoff) => { handoff.remote_actions_performed = 'push'; }]
  ])('rejects false-green handoff evidence: %s', (_name, mutate) => {
    const handoff = releaseHandoff();
    mutate(handoff);

    expect(validateReleaseHandoff({
      handoff,
      dispatchBase: DISPATCH_BASE,
      artifact: artifactFreeze(),
      packetSha256: 'e'.repeat(64),
      expectedIntegratedIssues: [78]
    })).toEqual({ success: false, error: expect.any(String) });
  });

  test.each([
    ['issues', (handoff) => { handoff.issues = []; }],
    ['closeout', (handoff) => { handoff.closeout_intent = []; }],
    ['expected set', (_handoff, options) => { options.expectedIntegratedIssues = [77]; }]
  ])('rejects delivered scope drift in %s', (_name, mutate) => {
    const handoff = releaseHandoff();
    const options = { handoff, dispatchBase: DISPATCH_BASE, artifact: artifactFreeze(),
      packetSha256: 'e'.repeat(64), expectedIntegratedIssues: [78] };
    mutate(handoff, options);
    expect(validateReleaseHandoff(options).success).toBe(false);
  });
});

function artifactFreeze(overrides = {}) {
  return {
    source_commit: HEAD,
    source_clean: true,
    artifact_paths: ['/tmp/dverity-5.0.0.tgz'],
    name: 'dverity-5.0.0.tgz',
    size: 1024,
    sha512: SHA512,
    npm_integrity: INTEGRITY,
    inventory: [
      { path: 'package.json', size: 1, mode: 420, sha256: 'a'.repeat(64) },
      { path: 'skills/dverity-repair/SKILL.md', size: 2, mode: 420, sha256: 'b'.repeat(64) }
    ],
    repack: { sha512: SHA512, npm_integrity: INTEGRITY },
    procedure: ['npm pack --json --pack-destination <tmp-1>', 'npm pack --json --pack-destination <tmp-2>'],
    tools: { node: 'v22.0.0', npm: '10.9.4', git: '2.52.0', tar: '3.5.3' },
    ...overrides
  };
}

function primaryOwnership() {
  const groups = {
    65: ['DV-DOC-001'],
    66: ['DV-SRC-001', 'DV-SRC-002', 'DV-SRC-003'],
    67: ['DV-REP-001', 'DV-REP-002', 'DV-REP-003', 'DV-REP-004', 'DV-DOC-002'],
    68: ['DV-SIM-001', 'DV-SUB-001', 'DV-SUB-002'],
    69: ['DV-MRG-001', 'DV-MRG-002', 'DV-REV-001', 'DV-REV-002', 'DV-REV-003'],
    70: ['DV-REM-001', 'DV-REM-002', 'DV-MRG-003', 'DV-MRG-004'],
    71: ['DV-CLI-001', 'DV-CLI-002', 'DV-CLI-003', 'DV-CLI-004', 'DV-CLI-005', 'DV-OWN-001', 'DV-OWN-002', 'DV-OWN-003'],
    72: ['DV-INS-001', 'DV-INS-002', 'DV-INS-003', 'DV-INS-004'],
    73: ['DV-MIG-001', 'DV-MIG-002', 'DV-MIG-003', 'DV-OWN-004'],
    74: ['DV-MIG-004', 'DV-MIG-005', 'DV-MIG-006'],
    75: ['DV-DWN-001'],
    76: ['DV-LEG-001', 'DV-LEG-002'],
    77: ['DV-DOC-003'],
    78: ['DV-REL-001'],
    79: ['DV-REL-002', 'DV-REL-003', 'DV-REL-005', 'DV-REL-006'],
    80: ['DV-DOC-004', 'DV-DWN-002', 'DV-DWN-003', 'DV-REL-004', 'DV-REL-007', 'DV-REL-008']
  };
  return Object.entries(groups).flatMap(([issue, ids]) => ids.map((acceptanceId) => ({
    acceptance_id: acceptanceId,
    primary_issue: Number(issue),
    source: `https://github.com/Dimon94/cc-devflow/issues/${issue}`
  })));
}

function acceptancePacket(ownership) {
  const ownerById = new Map(ownership.map((row) => [row.acceptance_id, row.primary_issue]));
  const results = catalog.rows.map((row) => {
    if (['DV-INS-002', 'DV-INS-003'].includes(row.acceptance_id)) {
      return hostCarryResult(row.acceptance_id, ownerById.get(row.acceptance_id));
    }
    if (/live/i.test(row.execution_class)) {
      return pendingResult(row.acceptance_id, ownerById.get(row.acceptance_id));
    }
    return terminalResult(row.acceptance_id, ownerById.get(row.acceptance_id));
  });
  return generateAcceptancePacket({ catalog, metadata: packetMetadata(), results }).data;
}

function terminalResult(acceptanceId, primaryIssue) {
  return {
    acceptance_id: acceptanceId,
    outcome: 'pass',
    started_at: '2026-07-11T00:00:00.000Z',
    finished_at: '2026-07-11T00:00:01.000Z',
    freshness: {
      source_commit: HEAD,
      artifact_sha512: SHA512,
      executor: {
        owner_evidence_verified: true,
        integrated_commit_ancestor: true,
        current_full_gate_pass: true,
        current_publish_gate_pass: true,
        row_executor_pass: true,
        predicate_bound: true
      }
    },
    authority: { primary_owner_issue: primaryIssue, remote_actions_performed: 'none' },
    evidence_refs: [{ kind: 'executor-result', uri: 'artifact://gate.log', sha256: 'f'.repeat(64) }],
    mutation: emptyMutation()
  };
}

function hostCarryResult(acceptanceId, primaryIssue) {
  const result = terminalResult(acceptanceId, primaryIssue);
  result.freshness.host_carry_forward = {
    evidence_head_ancestor: true,
    skill_bytes_identical: true,
    artifact_digest_match: true,
    host_version_unchanged: true
  };
  return result;
}

function pendingResult(acceptanceId, primaryIssue) {
  return {
    acceptance_id: acceptanceId,
    outcome: 'pending',
    started_at: null,
    finished_at: null,
    freshness: { source_commit: HEAD, artifact_sha512: SHA512, live_gate: 'not-executed' },
    authority: {
      primary_owner_issue: primaryIssue,
      user_authority: [79, 80].includes(primaryIssue) ? 'explicit-stop' : 'not-granted',
      remote_actions_performed: 'none'
    },
    evidence_refs: [{ kind: 'gate-log', uri: 'artifact://gate.log', sha256: 'f'.repeat(64) }],
    mutation: emptyMutation()
  };
}

function emptyMutation() {
  return { before_gate: null, requested: [], performed: [], readback: [], rollback_or_fix_forward_boundary: null };
}

function packetMetadata() {
  return {
    run_id: 'issue-78-freeze',
    created_at: '2026-07-11T00:00:00.000Z',
    repo: 'Dimon94/cc-devflow',
    source_commit: HEAD,
    artifact: { name: 'dverity-5.0.0.tgz', sha512: SHA512, npm_integrity: INTEGRITY },
    environment: { node: 'v22.0.0', npm: '10.9.4', os: 'darwin', host_versions: { agents: '0.138.0', claude: '2.1.198' } }
  };
}

function rollup(results) {
  return results.reduce((counts, result) => {
    counts[result.outcome] += 1;
    return counts;
  }, { pass: 0, fail: 0, blocked: 0, unknown: 0, pending: 0 });
}

function releaseHandoff() {
  return {
    source: INTEGRATION_BRANCH,
    target: 'origin/main',
    base: BASE,
    head: HEAD,
    ahead_commits: [DISPATCH_BASE, HEAD],
    scope_source: { kind: 'wayfinder', url: 'https://github.com/Dimon94/cc-devflow/issues/56' },
    spec: 'https://github.com/Dimon94/cc-devflow/issues/64',
    issues: ['https://github.com/Dimon94/cc-devflow/issues/78'],
    checks: [{ command: 'npm test -- --runInBand', status: 'pass' }],
    local_review: { status: 'pass', base: BASE, head: HEAD },
    touched_paths: ['lib/dverity/release/release-readiness.js'],
    risks: ['17 live rows remain pending'],
    closeout_intent: [{ issue: '#78', action: 'close-after-merge' }],
    remote_actions_performed: 'none',
    release_readiness: {
      provider: 'github',
      repo: 'Dimon94/cc-devflow',
      remote: 'origin',
      target: 'origin/main',
      integration_branch: INTEGRATION_BRANCH,
      parent_thread: '019f4eac-d73f-7770-9fdb-95244911c96e',
      worktree: '/tmp/dverity-worktree',
      source_clean: true,
      dispatch_base: DISPATCH_BASE,
      artifact: {
        path: '/tmp/dverity-5.0.0.tgz', source_commit: HEAD,
        sha512: SHA512, npm_integrity: INTEGRITY
      },
      acceptance_packet: { path: '/tmp/dverity-acceptance-packet.json', sha256: 'e'.repeat(64) },
      diff: {
        base: BASE,
        head: HEAD,
        touched_paths_sha256: require('crypto').createHash('sha256')
          .update('lib/dverity/release/release-readiness.js\n').digest('hex')
      },
      ticket_review: { status: 'pass', base: DISPATCH_BASE, head: HEAD, axes: ['Standards', 'Spec'] },
      readiness_verdict: 'blocked-pending-live',
      next_owner: 'Dverity',
      next_action: 'submit-remote-review'
    }
  };
}
