const {
  adaptGitHubReviewItem,
  adaptGitLabReviewItem,
  evaluateLandingGate,
  landRemoteReview
} = require('../../review/landing');

const HEAD = 'b'.repeat(40);
const BASE = 'a'.repeat(40);
const MERGE_SHA = 'c'.repeat(40);
const OTHER_SHA = 'd'.repeat(40);

describe('Dverity provider landing adapters', () => {
  test.each([
    ['unknown protection', { queries: { protection: { status: 'unknown' } } }],
    ['protection query failure', { queries: { protection: { status: 'systemError' } } }],
    ['configured required review', { queries: { required_reviews: { count: 1 } } }],
    ['configured required checks', { queries: { required_checks: { contexts: ['ci/test'] } } }],
    ['partial provider evidence', { queries: { rulesets: { status: 'partial' } } }],
    ['stale local evidence', { readiness: { head: OTHER_SHA } }],
    ['artifact head mismatch', { readiness: { artifact: {
      status: 'pass', source_commit: OTHER_SHA, sha512: 'e'.repeat(128)
    } } }],
    ['non-fresh review', { review: { mode: 'carry-forward', carried_from: OTHER_SHA } }],
    ['review head mismatch', { review: { head: OTHER_SHA } }]
  ])('blocks GitHub no-gates fallback with %s', (_name, changes) => {
    const prior = reviewItemRecord({
      approvals: { state: 'unknown' },
      ci_state: { state: 'unknown' },
      current_head_review: changes.review
        ? { ...freshReview(), ...changes.review }
        : freshReview(),
      local_readiness: { ...localReadiness(), ...changes.readiness }
    });
    const snapshot = githubSnapshot({
      item: { reviewDecision: null },
      checks: [],
      gate_queries: githubQueries(changes.queries)
    });

    expect(adapterVerdict(adaptGitHubReviewItem(snapshot, prior)))
      .toMatchObject({ success: false, terminal: 'blocked' });
  });

  test('allows authenticated GitHub exact-zero gates to use fresh review and frozen local readiness', () => {
    const prior = reviewItemRecord({
      approvals: { state: 'unknown' },
      ci_state: { state: 'unknown' },
      local_readiness: localReadiness()
    });
    const adapted = adaptGitHubReviewItem(githubSnapshot({
      item: { reviewDecision: null },
      checks: [],
      gate_queries: githubNoGateQueries()
    }), prior);

    expect(evaluateLandingGate(adapted.record)).toMatchObject({
      success: true,
      terminal: 'landing-ready',
      strategy: 'direct'
    });
  });

  test('ignores caller-authored no-gates booleans without provider query evidence', () => {
    const prior = reviewItemRecord({
      approvals: { state: 'unknown' },
      ci_state: { state: 'unknown' },
      local_readiness: localReadiness()
    });
    const snapshot = githubSnapshot({ item: { reviewDecision: null }, checks: [] });
    snapshot.landing_policy = {
      protection: false,
      rulesets: false,
      required_reviews: 0,
      required_checks: 0
    };

    expect(adapterVerdict(adaptGitHubReviewItem(snapshot, prior)))
      .toMatchObject({ success: false, terminal: 'blocked' });
  });

  test('does not apply the GitHub no-gates fallback to GitLab', () => {
    const prior = reviewItemRecord({
      provider: 'gitlab',
      item: { id: '70', url: 'https://gitlab.example.test/dverity/-/merge_requests/70' },
      approvals: { state: 'unknown' },
      ci_state: { state: 'unknown' },
      local_readiness: localReadiness()
    });
    const snapshot = gitlabSnapshot({
      approvals: { approvals_left: null },
      pipeline: { status: null }
    });
    snapshot.gate_queries = githubNoGateQueries();

    expect(adapterVerdict(adaptGitLabReviewItem(snapshot, prior)))
      .toMatchObject({ success: false, terminal: 'blocked' });
  });

  test('maps GitHub and GitLab happy records to the same neutral landing truth', () => {
    const github = adaptGitHubReviewItem(githubSnapshot(), reviewItemRecord());
    const gitlab = adaptGitLabReviewItem(gitlabSnapshot(), reviewItemRecord({
      provider: 'gitlab',
      item: { id: '70', url: 'https://gitlab.example.test/dverity/-/merge_requests/70' }
    }));

    expect(github.success).toBe(true);
    expect(gitlab.success).toBe(true);
    expect(neutralTruth(github.record)).toEqual(neutralTruth(gitlab.record));
    expect(evaluateLandingGate(github.record)).toMatchObject({ success: true, strategy: 'direct' });
    expect(evaluateLandingGate(gitlab.record)).toMatchObject({ success: true, strategy: 'direct' });
  });

  test.each([
    ['anonymous', { identity: { actor: null } }, /authenticated actor/i],
    ['capability missing', { identity: { capabilities: ['review-item-read'] } }, /land capability/i],
    ['draft', { item: { draft: true } }, /draft/i],
    ['changes requested', { item: { reviewDecision: 'CHANGES_REQUESTED' } }, /approval/i],
    ['unresolved discussion', { unresolved_discussions: 1 }, /discussion/i],
    ['checks pending', { checks: [{ status: 'IN_PROGRESS', conclusion: null }] }, /checks.*pending/i],
    ['checks failed', { checks: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }, /checks.*failed/i],
    [
      'queue enqueued',
      { protection: { requires_queue: true }, queue: { state: 'QUEUED' } },
      /queue.*pending/i
    ],
    ['discussion truth missing', { unresolved_discussions: null }, /discussion/i],
    ['protection truth missing', { protection: { requires_queue: undefined } }, /protection/i]
  ])('blocks the GitHub %s scenario with one neutral verdict', (_name, overrides, reason) => {
    expect(adapterVerdict(adaptGitHubReviewItem(
      githubSnapshot(overrides),
      reviewItemRecord()
    ))).toMatchObject({ success: false, terminal: 'blocked', reason: expect.stringMatching(reason) });
  });

  test.each([
    ['anonymous', { identity: { actor: null } }, /authenticated actor/i],
    ['capability missing', { identity: { capabilities: ['review-item-read'] } }, /land capability/i],
    ['WIP', { item: { work_in_progress: true } }, /draft/i],
    ['approval missing', { approvals: { approvals_left: 1 } }, /approval/i],
    ['unresolved discussion', { discussions: [{ resolved: false }] }, /discussion/i],
    ['pipeline pending', { pipeline: { status: 'running' } }, /checks.*pending/i],
    ['pipeline failed', { pipeline: { status: 'failed' } }, /checks.*failed/i],
    [
      'merge train pending',
      { protection: { requires_train: true }, train: { status: 'checking' } },
      /train.*pending/i
    ],
    ['discussion truth missing', { discussions: null }, /discussion/i],
    ['protection truth missing', { protection: { requires_train: undefined } }, /protection/i]
  ])('blocks the GitLab %s scenario with one neutral verdict', (_name, overrides, reason) => {
    const prior = reviewItemRecord({
      provider: 'gitlab',
      item: { id: '70', url: 'https://gitlab.example.test/dverity/-/merge_requests/70' }
    });
    expect(adapterVerdict(adaptGitLabReviewItem(gitlabSnapshot(overrides), prior)))
      .toMatchObject({ success: false, terminal: 'blocked', reason: expect.stringMatching(reason) });
  });

  test.each([
    ['GitHub queue', githubSnapshot({ protection: { requires_queue: true } })],
    ['GitLab merge train', gitlabSnapshot({ protection: { requires_train: true } })]
  ])('allows the %s required state to proceed but not false-green before merged readback', (name, raw) => {
    const isGitHub = name.startsWith('GitHub');
    const prior = reviewItemRecord(isGitHub ? {} : {
      provider: 'gitlab',
      item: { id: '70', url: 'https://gitlab.example.test/dverity/-/merge_requests/70' }
    });
    const adapted = isGitHub
      ? adaptGitHubReviewItem(raw, prior)
      : adaptGitLabReviewItem(raw, prior);

    expect(evaluateLandingGate(adapted.record)).toMatchObject({
      success: true,
      strategy: isGitHub ? 'queue' : 'train'
    });
  });
});

describe('Dverity landing, parity, and closeout', () => {
  test.each([
    ['github', 'direct'],
    ['gitlab', 'train']
  ])('lands one named disposable %s item and proves full parity via %s', async (providerName, strategy) => {
    const record = reviewItemRecord(providerName === 'github' ? {
      protection_or_queue: { mode: strategy, state: strategy === 'direct' ? 'ready' : 'required' }
    } : {
      provider: 'gitlab',
      item: { id: '70', url: 'https://gitlab.example.test/dverity/-/merge_requests/70' },
      protection_or_queue: { mode: strategy, state: 'required' }
    });
    const provider = providerFixture({ record });
    const local = localFixture();

    const result = await landRemoteReview({
      candidate: { kind: 'provider-item', record },
      provider,
      local,
      authority: landingAuthority(providerName),
      closeout: closeoutPlan()
    });

    expect(result).toMatchObject({
      success: true,
      terminal: 'landed-parity-proven',
      packet: {
        schema_version: 1,
        status: 'landed-parity-proven',
        provider: providerName,
        merge_sha: MERGE_SHA,
        provider_item: { merged: true, merge_sha: MERGE_SHA },
        remote_target: { head: MERGE_SHA },
        tracking_ref: { head: MERGE_SHA },
        local_target: { head: MERGE_SHA },
        active_worktree: { head: MERGE_SHA, clean: true },
        post_merge_checks: { state: 'passed' }
      }
    });
    expect(provider.landReviewItem).toHaveBeenCalledWith(expect.objectContaining({ strategy }));
    expect(provider.calls()).toEqual([
      'readReviewItem',
      'landReviewItem',
      'readLanding',
      'readTarget',
      'readPostMergeChecks',
      'readIssue:#70',
      'closeIssue:#70',
      'readIssue:#70',
      'readIssue:#64',
      'readIssue:#69'
    ]);
    expect(local.calls()).toEqual(['readTrackingRef', 'readLocalTarget', 'readActiveWorktree']);
    expect(result.packet.closeout).toEqual([
      { issue: '#70', relation: 'direct', action: 'closed', state: 'closed' },
      { issue: '#64', relation: 'parent', action: 'related-only', state: 'open' },
      { issue: '#69', relation: 'blocker', action: 'related-only', state: 'open' }
    ]);
  });

  test.each([
    ['provider landing missing', { provider: { landing: { merge_sha: null } } }, /merge[_ ]sha/i],
    ['checks pending', { provider: { checks: { state: 'pending' } } }, /post-merge checks/i],
    ['checks bound to another SHA', { provider: { checks: { sha: OTHER_SHA } } }, /post-merge checks/i],
    ['remote target identity mismatch', { provider: { target: { repo: 'Other/dverity' } } }, /remote target/i],
    ['tracking mismatch', { local: { tracking: { head: OTHER_SHA } } }, /tracking ref/i],
    ['tracking target mismatch', { local: { tracking: { target: 'origin/release' } } }, /tracking ref/i],
    ['local target mismatch', { local: { target: { head: OTHER_SHA } } }, /local target/i],
    ['active head diverged', { local: { active: { head: OTHER_SHA } } }, /active worktree head/i],
    ['active worktree dirty', { local: { active: { clean: false } } }, /active worktree is dirty/i],
    ['issue scope mismatch', { provider: { issue: { repo: 'Other/dverity' } } }, /issue readback/i]
  ])('blocks a %s after recording the irreversible landing audit', async (_name, overrides, reason) => {
    const record = reviewItemRecord();
    const provider = providerFixture({ record, ...(overrides.provider || {}) });
    const local = localFixture(overrides.local || {});

    const result = await landRemoteReview({
      candidate: { kind: 'provider-item', record },
      provider,
      local,
      authority: landingAuthority('github'),
      closeout: closeoutPlan()
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(reason);
    expect(result.mutation_audit.performed).toContainEqual(expect.objectContaining({
      operation: 'land-review-item'
    }));
    expect(provider.closeIssue).not.toHaveBeenCalled();
  });

  test.each([
    ['parent', [{ issue: '#64', relation: 'parent', action: 'close-after-merge' }]],
    ['sibling', [{ issue: '#71', relation: 'sibling', action: 'close-after-merge' }]],
    ['blocker', [{ issue: '#69', relation: 'blocker', action: 'close-after-merge' }]],
    ['partial slice', [{ issue: '#70', relation: 'partial', action: 'close-after-merge' }]]
  ])('blocks recursive closeout of a %s before landing', async (_name, closeout) => {
    const record = reviewItemRecord({
      closeout_intent: closeout.map(({ issue, action }) => ({ issue, action }))
    });
    const provider = providerFixture({ record });

    const result = await landRemoteReview({
      candidate: { kind: 'provider-item', record },
      provider,
      local: localFixture(),
      authority: landingAuthority('github'),
      closeout
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(/direct completed issue|closeout/i);
    expect(provider.landReviewItem).not.toHaveBeenCalled();
    expect(provider.closeIssue).not.toHaveBeenCalled();
  });

  test('blocks when post-close readback does not prove the direct issue closed', async () => {
    const record = reviewItemRecord();
    const provider = providerFixture({ record, close_readback: 'open' });

    const result = await landRemoteReview({
      candidate: { kind: 'provider-item', record },
      provider,
      local: localFixture(),
      authority: landingAuthority('github'),
      closeout: closeoutPlan()
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(/closeout readback/i);
    expect(result.mutation_audit.performed).toContainEqual({
      operation: 'close-issue',
      issue: '#70'
    });
  });
});

function adapterVerdict(adapted) {
  return adapted.success ? evaluateLandingGate(adapted.record) : adapted;
}

function neutralTruth(record) {
  return {
    draft: record.draft,
    approvals: record.approvals,
    unresolved_discussions: record.unresolved_discussions,
    mergeability: record.mergeability,
    protection_or_queue: record.protection_or_queue,
    ci_state: record.ci_state
  };
}

function merge(base, override) {
  if (!override) return base;
  return { ...base, ...override };
}

function githubSnapshot(overrides = {}) {
  return {
    identity: merge({
      actor: 'fixture-user',
      capabilities: ['review-item-read', 'review-item-land', 'issue-read', 'issue-close']
    }, overrides.identity),
    item: merge({
      id: '70',
      url: 'https://github.example.test/Dimon94/dverity/pull/70',
      repo: 'Dimon94/dverity',
      source: 'codex/dverity-5-integration',
      target: 'origin/main',
      head: HEAD,
      base: BASE,
      draft: false,
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN'
    }, overrides.item),
    unresolved_discussions: Object.hasOwn(overrides, 'unresolved_discussions')
      ? overrides.unresolved_discussions
      : 0,
    checks: overrides.checks || [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    protection: merge({ requires_queue: false }, overrides.protection),
    gate_queries: overrides.gate_queries,
    queue: overrides.queue || null
  };
}

function gitlabSnapshot(overrides = {}) {
  return {
    identity: merge({
      actor: 'fixture-user',
      capabilities: ['review-item-read', 'review-item-land', 'issue-read', 'issue-close']
    }, overrides.identity),
    item: merge({
      iid: '70',
      web_url: 'https://gitlab.example.test/dverity/-/merge_requests/70',
      repo: 'Dimon94/dverity',
      source_branch: 'codex/dverity-5-integration',
      target_branch: 'origin/main',
      sha: HEAD,
      base_sha: BASE,
      work_in_progress: false,
      detailed_merge_status: 'mergeable'
    }, overrides.item),
    approvals: merge({ approvals_left: 0 }, overrides.approvals),
    discussions: Object.hasOwn(overrides, 'discussions') ? overrides.discussions : [],
    pipeline: merge({ status: 'success' }, overrides.pipeline),
    protection: merge({ requires_train: false }, overrides.protection),
    train: overrides.train || null
  };
}

function reviewItemRecord(overrides = {}) {
  const provider = overrides.provider || 'github';
  const item = overrides.item || {
    id: '70',
    url: 'https://github.example.test/Dimon94/dverity/pull/70'
  };
  const defaultReview = {
    schema_version: 1,
    provider,
    repo: 'Dimon94/dverity',
    item,
    head: HEAD,
    task_session: 'review-session-70',
    facets: ['standards', 'spec'],
    findings: [],
    verdict: 'pass',
    mode: 'fresh',
    carried_from: null,
    read_only: true
  };
  const currentReview = Object.hasOwn(overrides, 'current_head_review')
    ? overrides.current_head_review
    : defaultReview;
  return {
    provider,
    repo: 'Dimon94/dverity',
    item,
    source: 'codex/dverity-5-integration',
    target: 'origin/main',
    head: HEAD,
    base: BASE,
    auth_actor: 'fixture-user',
    capability: ['review-item-read', 'review-item-land', 'issue-read', 'issue-close'],
    draft: false,
    approvals: { state: 'approved' },
    unresolved_discussions: [],
    mergeability: { state: 'mergeable' },
    protection_or_queue: { mode: 'direct', state: 'ready' },
    ci_state: { state: 'passed' },
    landing_policy: null,
    local_readiness: null,
    current_head_review: currentReview,
    closeout_intent: [
      { issue: '#70', action: 'close-after-merge' },
      { issue: '#64', action: 'related-only' },
      { issue: '#69', action: 'related-only' }
    ],
    mutation_scope: {
      repo: 'Dimon94/dverity',
      source: 'codex/dverity-5-integration',
      target: 'origin/main',
      item: '70',
      allowed: ['review', 'land']
    },
    ...overrides,
    current_head_review: currentReview
  };
}

function freshReview() {
  return {
    schema_version: 1,
    provider: 'github',
    repo: 'Dimon94/dverity',
    item: { id: '70', url: 'https://github.example.test/Dimon94/dverity/pull/70' },
    head: HEAD,
    task_session: 'review-session-70',
    facets: ['standards', 'spec'],
    findings: [],
    verdict: 'pass',
    mode: 'fresh',
    carried_from: null,
    read_only: true
  };
}

function githubNoGateQueries() {
  return {
    protection: { endpoint: 'branch-protection', status: 'not-found' },
    rulesets: { endpoint: 'rulesets', status: 'complete', matching: [] },
    required_reviews: { endpoint: 'required-reviews', status: 'complete', count: 0 },
    required_checks: { endpoint: 'required-checks', status: 'complete', contexts: [] }
  };
}

function githubQueries(overrides = {}) {
  const queries = githubNoGateQueries();
  return Object.fromEntries(Object.entries(queries).map(([key, value]) => [
    key,
    { ...value, ...(overrides[key] || {}) }
  ]));
}

function localReadiness() {
  return {
    head: HEAD,
    frozen: true,
    full: { status: 'pass', head: HEAD },
    publish: { status: 'pass', head: HEAD },
    production_audit: { status: 'pass', head: HEAD },
    artifact: { status: 'pass', source_commit: HEAD, sha512: 'e'.repeat(128) }
  };
}

function landingAuthority(provider) {
  return {
    provider,
    repo: 'Dimon94/dverity',
    item: '70',
    source: 'codex/dverity-5-integration',
    target: 'origin/main',
    land: true,
    close_issues: true,
    direct_issues: ['#70'],
    max_review_items: 1
  };
}

function closeoutPlan() {
  return [
    { issue: '#70', relation: 'direct', action: 'close-after-merge' },
    { issue: '#64', relation: 'parent', action: 'related-only' },
    { issue: '#69', relation: 'blocker', action: 'related-only' }
  ];
}

function providerFixture({
  record,
  landing = {},
  target = {},
  checks = {},
  issue: issueReadback = {},
  close_readback: closeReadback = 'closed'
}) {
  const calls = [];
  const closed = new Set();
  return {
    readReviewItem: jest.fn(async () => {
      calls.push('readReviewItem');
      return record;
    }),
    landReviewItem: jest.fn(async () => {
      calls.push('landReviewItem');
      return { accepted: true };
    }),
    readLanding: jest.fn(async () => {
      calls.push('readLanding');
      return {
        provider: record.provider,
        repo: record.repo,
        item: record.item,
        head: record.head,
        target: record.target,
        auth_actor: record.auth_actor,
        merged: true,
        merge_sha: MERGE_SHA,
        ...landing
      };
    }),
    readTarget: jest.fn(async () => {
      calls.push('readTarget');
      return { repo: record.repo, target: record.target, head: MERGE_SHA, ...target };
    }),
    readPostMergeChecks: jest.fn(async () => {
      calls.push('readPostMergeChecks');
      return { state: 'passed', sha: MERGE_SHA, url: 'https://checks.example.test/70', ...checks };
    }),
    readIssue: jest.fn(async ({ issue }) => {
      calls.push(`readIssue:${issue}`);
      const state = closed.has(issue) && closeReadback === 'closed' ? 'closed' : 'open';
      return {
        provider: record.provider,
        repo: record.repo,
        issue,
        state,
        auth_actor: record.auth_actor,
        ...issueReadback
      };
    }),
    closeIssue: jest.fn(async ({ issue }) => {
      calls.push(`closeIssue:${issue}`);
      closed.add(issue);
      return { issue };
    }),
    calls: () => calls
  };
}

function localFixture({ tracking = {}, target = {}, active = {} } = {}) {
  const calls = [];
  return {
    readTrackingRef: jest.fn(async () => {
      calls.push('readTrackingRef');
      return { ref: 'origin/main', target: 'origin/main', head: MERGE_SHA, ...tracking };
    }),
    readLocalTarget: jest.fn(async () => {
      calls.push('readLocalTarget');
      return { ref: 'main', target: 'origin/main', head: MERGE_SHA, ...target };
    }),
    readActiveWorktree: jest.fn(async () => {
      calls.push('readActiveWorktree');
      return { target: 'origin/main', head: MERGE_SHA, clean: true, ...active };
    }),
    calls: () => calls
  };
}
