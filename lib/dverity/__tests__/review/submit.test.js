const {
  REVIEW_ITEM_RECORD_FIELDS,
  createReviewItemRecord,
  createSubmitReviewItemRecord
} = require('../../review/review-item-record');
const { submitRemoteReview } = require('../../review/submit');

const HEAD = 'b'.repeat(40);
const BASE = 'a'.repeat(40);

describe('Dverity Submit', () => {
  test('submits a clean ahead source and returns the one provider-neutral record shape', async () => {
    const sourceReader = sourceReaderFixture();
    const provider = providerFixture();

    const result = await submitRemoteReview(submitInput({ sourceReader, provider }));

    expect(result.success).toBe(true);
    expect(sourceReader).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.record)).toEqual(REVIEW_ITEM_RECORD_FIELDS);
    expect(result.record).toEqual({
      provider: 'github',
      repo: 'Dimon94/dverity',
      item: { id: '68', url: 'https://example.test/review/68' },
      source: 'codex/dverity-5-integration',
      target: 'origin/main',
      head: HEAD,
      base: BASE,
      auth_actor: 'fixture-user',
      capability: ['push', 'review-item-write'],
      draft: false,
      approvals: null,
      unresolved_discussions: null,
      mergeability: null,
      protection_or_queue: null,
      ci_state: null,
      landing_policy: null,
      local_readiness: null,
      current_head_review: null,
      closeout_intent: [{ issue: '#68', action: 'close-after-merge' }],
      mutation_scope: {
        repo: 'Dimon94/dverity',
        source: 'codex/dverity-5-integration',
        target: 'origin/main',
        item: '68',
        allowed: ['push', 'review-item:create-or-update']
      }
    });
    expect(provider.calls()).toEqual([
      'discover',
      'push',
      'createReviewItem',
      'readReviewItem'
    ]);
    expect(result.mutation_audit.performed).toEqual([
      { operation: 'push', source: 'codex/dverity-5-integration', head: HEAD },
      { operation: 'create-review-item', item: '68' }
    ]);
  });

  test('reuses the single existing same-source review item', async () => {
    const existing = reviewItem({ id: '41', url: 'https://example.test/review/41' });
    const provider = providerFixture({ items: [existing] });

    const result = await submitRemoteReview(submitInput({ provider }));

    expect(result.success).toBe(true);
    expect(result.record.item).toEqual({ id: '41', url: existing.url });
    expect(provider.calls()).toEqual([
      'discover',
      'push',
      'updateReviewItem',
      'readReviewItem'
    ]);
  });

  test('keeps discovery read-only when source or item authority is missing', async () => {
    for (const input of [
      submitInput({ source: null }),
      submitInput({ authority: null })
    ]) {
      const provider = providerFixture();
      const result = await submitRemoteReview({ ...input, provider });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/source scope|required authority/i);
      expect(provider.calls()).toEqual(['discover']);
      expect(result.mutation_audit.performed).toEqual([]);
    }
  });

  test.each([
    ['anonymous discovery', { auth_actor: null }],
    ['missing push capability', { capability: ['review-item-write'] }],
    ['missing review-item capability', { capability: ['push'] }]
  ])('blocks %s with zero mutation', async (_name, discovery) => {
    const provider = providerFixture({ discovery });

    const result = await submitRemoteReview(submitInput({ provider }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/authenticated actor|capability/i);
    expect(provider.calls()).toEqual(['discover']);
    expect(result.mutation_audit.performed).toEqual([]);
  });

  test.each([
    ['dirty source', { clean: false }],
    ['not ahead', { ahead_commits: [] }],
    ['behind live target', { behind: 1 }],
    ['stale base', { base: 'c'.repeat(40) }]
  ])('blocks a %s before provider mutation', async (_name, proofChange) => {
    const provider = providerFixture();
    const sourceReader = sourceReaderFixture({ proofChange });

    const result = await submitRemoteReview(submitInput({ provider, sourceReader }));

    expect(result.success).toBe(false);
    expect(provider.calls()).toEqual([]);
    expect(result.mutation_audit.performed).toEqual([]);
  });

  test('blocks stale or incomplete handoff evidence before provider mutation', async () => {
    const invalidHandoffs = [
      { ...handoffFixture(), remote_actions_performed: 'push' },
      { ...handoffFixture(), touched_paths: [] },
      { ...handoffFixture(), checks: [] },
      {
        ...handoffFixture(),
        local_review: { ...handoffFixture().local_review, head: 'c'.repeat(40) }
      }
    ];

    for (const handoff of invalidHandoffs) {
      const provider = providerFixture();
      const result = await submitRemoteReview(submitInput({ provider, handoff }));

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/handoff|remote actions|touched|checks|review/i);
      expect(provider.calls()).toEqual([]);
    }
  });

  test('accepts the issue-78 release-readiness extension without weakening Submit proof', async () => {
    const handoff = {
      ...handoffFixture(),
      release_readiness: releaseReadinessFixture()
    };

    const result = await submitRemoteReview(submitInput({ handoff }));

    expect(result.success).toBe(true);
    expect(result.evidence.handoff.release_readiness).toEqual(releaseReadinessFixture());
  });

  test('accepts the generated release handoff strict shape through read-only discovery', async () => {
    const handoff = { ...handoffFixture(), release_readiness: releaseReadinessFixture() };
    const provider = providerFixture({ discovery: { capability: [] } });

    expect(handoff).not.toHaveProperty('integration_history');
    const result = await submitRemoteReview(submitInput({ handoff, provider }));

    expect(result.error).toMatch(/capability/i);
    expect(provider.calls()).toEqual(['discover']);
    expect(result.mutation_audit.requested).toEqual([]);
    expect(result.mutation_audit.performed).toEqual([]);
  });

  test.each([
    ['repo', { repo: 'Other/repo' }],
    ['target', { target: 'origin/other' }],
    ['integration branch', { integration_branch: 'other/source' }],
    ['source commit', { artifact: { ...releaseReadinessFixture().artifact, source_commit: 'c'.repeat(40) } }],
    ['diff', { diff: { ...releaseReadinessFixture().diff, touched_paths_sha256: 'a'.repeat(64) } }],
    ['ticket review', {
      ticket_review: { ...releaseReadinessFixture().ticket_review, head: 'c'.repeat(40) }
    }]
  ])('blocks a release handoff with mismatched %s before provider mutation', async (_name, change) => {
    const handoff = {
      ...handoffFixture(),
      release_readiness: { ...releaseReadinessFixture(), ...change }
    };
    const provider = providerFixture();

    const result = await submitRemoteReview(submitInput({ handoff, provider }));

    expect(result.success).toBe(false);
    expect(provider.calls()).toEqual([]);
  });

  test('blocks a provider identity mismatch before mutation', async () => {
    const handoff = { ...handoffFixture(), release_readiness: releaseReadinessFixture() };
    const provider = providerFixture({ discovery: { provider: 'gitlab' } });

    const result = await submitRemoteReview(submitInput({ handoff, provider }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/provider/i);
    expect(provider.calls()).toEqual(['discover']);
  });

  test('revalidates the source and blocks a moved target before push', async () => {
    const provider = providerFixture();
    const sourceReader = sourceReaderFixture({
      secondProofChange: { target_head: 'd'.repeat(40), base: 'd'.repeat(40) }
    });

    const result = await submitRemoteReview(submitInput({ provider, sourceReader }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/changed during submit preflight/i);
    expect(sourceReader).toHaveBeenCalledTimes(2);
    expect(provider.calls()).toEqual(['discover']);
    expect(result.mutation_audit.performed).toEqual([]);
  });

  test('blocks duplicate same-source items with zero mutation', async () => {
    const provider = providerFixture({
      items: [reviewItem({ id: '41' }), reviewItem({ id: '42' })]
    });

    const result = await submitRemoteReview(submitInput({ provider }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/multiple same-source review items/i);
    expect(provider.calls()).toEqual(['discover']);
    expect(result.mutation_audit.performed).toEqual([]);
  });

  test('rejects approve, land, close, batch, or mismatched-source authority', async () => {
    const authorities = [
      { ...authorityFixture(), approve: true },
      { ...authorityFixture(), land: true },
      { ...authorityFixture(), close_issue: true },
      { ...authorityFixture(), max_review_items: 2 },
      { ...authorityFixture(), source: 'other/source' },
      { ...authorityFixture(), repo: 'other/repo' },
      { ...authorityFixture(), target: 'origin/other' }
    ];

    for (const authority of authorities) {
      const provider = providerFixture();
      const result = await submitRemoteReview(submitInput({ provider, authority }));

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/authority|single review item|source/i);
      expect(provider.calls()).toEqual([]);
      expect(result.mutation_audit.performed).toEqual([]);
    }
  });

  test.each([
    ['anonymous', { auth_actor: null }],
    ['wrong head', { head: 'c'.repeat(40) }],
    ['wrong source', { source: 'other/source' }],
    ['draft', { draft: true }],
    ['malformed URL', { url: 'not-a-url' }]
  ])('does not false-green an %s provider readback', async (_name, readback) => {
    const provider = providerFixture({ readback });

    const result = await submitRemoteReview(submitInput({ provider }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/authenticated|readback|record/i);
    expect(result.record).toBeUndefined();
    expect(provider.calls()).toEqual([
      'discover',
      'push',
      'createReviewItem',
      'readReviewItem'
    ]);
  });

  test('does not accept an update response that switches the existing item', async () => {
    const existing = reviewItem({ id: '41', url: 'https://example.test/review/41' });
    const provider = providerFixture({ items: [existing], submitted: { id: '68' } });

    const result = await submitRemoteReview(submitInput({ provider }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/existing review item/i);
    expect(result.record).toBeUndefined();
    expect(provider.calls()).toEqual(['discover', 'push', 'updateReviewItem']);
    expect(result.mutation_audit.performed).toEqual([
      { operation: 'push', source: 'codex/dverity-5-integration', head: HEAD },
      { operation: 'update-review-item', item: '41', result_item: '68' }
    ]);
  });

  test('uses the same neutral record shape for GitHub and GitLab providers', async () => {
    const provider = providerFixture({
      discovery: { provider: 'gitlab' },
      readback: { provider: 'gitlab' }
    });

    const result = await submitRemoteReview(submitInput({ provider }));

    expect(result.success).toBe(true);
    expect(result.record.provider).toBe('gitlab');
    expect(Object.keys(result.record)).toEqual(REVIEW_ITEM_RECORD_FIELDS);
  });
});

describe('provider-neutral review item record', () => {
  test('rejects extra fields so Submit and Merge cannot fork the record shape', () => {
    expect(() => createReviewItemRecord({
      ...recordFixture(),
      submit_verdict: 'ready'
    })).toThrow(/unrecognized key/i);
  });

  test('rejects a Submit-owned review verdict', () => {
    expect(() => createSubmitReviewItemRecord({
      ...recordFixture(),
      current_head_review: { verdict: 'pass' }
    })).toThrow(/Submit must not own current-head review/i);
  });
});

function submitInput(overrides = {}) {
  const source = Object.prototype.hasOwnProperty.call(overrides, 'source')
    ? overrides.source
    : 'codex/dverity-5-integration';
  return {
    repo: 'Dimon94/dverity',
    source,
    target: 'origin/main',
    handoff: handoffFixture(),
    authority: authorityFixture(),
    sourceReader: sourceReaderFixture(),
    provider: providerFixture(),
    ...overrides
  };
}

function sourceProof(overrides = {}) {
  return {
    source: 'codex/dverity-5-integration',
    target: 'origin/main',
    target_head: BASE,
    base: BASE,
    head: HEAD,
    clean: true,
    behind: 0,
    ahead_commits: [HEAD],
    touched_paths: ['skills/submit-remote-review/SKILL.md'],
    ...overrides
  };
}

function sourceReaderFixture({ proofChange = {}, secondProofChange = {} } = {}) {
  return jest.fn()
    .mockResolvedValueOnce(sourceProof(proofChange))
    .mockResolvedValueOnce(sourceProof(secondProofChange));
}

function handoffFixture() {
  return {
    source: 'codex/dverity-5-integration',
    target: 'origin/main',
    base: BASE,
    head: HEAD,
    ahead_commits: [HEAD],
    scope_source: {
      kind: 'wayfinder',
      url: 'https://github.com/Dimon94/cc-devflow/issues/56'
    },
    spec: 'https://github.com/Dimon94/cc-devflow/issues/64',
    issues: ['https://github.com/Dimon94/cc-devflow/issues/68'],
    checks: [{ command: 'npm test', status: 'pass' }],
    local_review: { status: 'pass', base: BASE, head: HEAD },
    touched_paths: ['skills/submit-remote-review/SKILL.md'],
    risks: ['live provider behavior remains a later named smoke gate'],
    closeout_intent: [{ issue: '#68', action: 'close-after-merge' }],
    remote_actions_performed: 'none'
  };
}

function authorityFixture() {
  return {
    repo: 'Dimon94/dverity',
    source: 'codex/dverity-5-integration',
    target: 'origin/main',
    review_item: { id: null, title: 'Dverity Submit' },
    push: true,
    create_or_update: true,
    max_review_items: 1,
    approve: false,
    land: false,
    close_issue: false
  };
}

function releaseReadinessFixture() {
  return {
    provider: 'github',
    repo: 'Dimon94/dverity',
    remote: 'origin',
    target: 'origin/main',
    integration_branch: 'codex/dverity-5-integration',
    parent_thread: '019f4eac-d73f-7770-9fdb-95244911c96e',
    worktree: '/tmp/dverity-worktree',
    source_clean: true,
    dispatch_base: 'd'.repeat(40),
    artifact: {
      path: '/tmp/dverity-5.0.0.tgz',
      source_commit: HEAD,
      sha512: 'e'.repeat(128),
      npm_integrity: 'sha512-ZHZlcml0eQ=='
    },
    acceptance_packet: {
      path: '/tmp/dverity-acceptance-packet.json',
      sha256: 'f'.repeat(64)
    },
    diff: {
      base: BASE,
      head: HEAD,
      touched_paths_sha256: require('crypto').createHash('sha256')
        .update('skills/submit-remote-review/SKILL.md\n').digest('hex')
    },
    ticket_review: {
      status: 'pass',
      base: 'd'.repeat(40),
      head: HEAD,
      axes: ['Standards', 'Spec']
    },
    readiness_verdict: 'blocked-pending-live',
    next_owner: 'Dverity',
    next_action: 'submit-remote-review'
  };
}

function reviewItem(overrides = {}) {
  return {
    provider: 'github',
    repo: 'Dimon94/dverity',
    id: '68',
    url: 'https://example.test/review/68',
    source: 'codex/dverity-5-integration',
    target: 'origin/main',
    head: HEAD,
    draft: false,
    auth_actor: 'fixture-user',
    ...overrides
  };
}

function providerFixture({ items = [], discovery = {}, submitted = {}, readback = {} } = {}) {
  const calls = [];
  const provider = {
    discover: jest.fn(async () => {
      calls.push('discover');
      return {
        provider: 'github',
        auth_actor: 'fixture-user',
        capability: ['push', 'review-item-write'],
        items,
        ...discovery
      };
    }),
    push: jest.fn(async () => {
      calls.push('push');
      return { head: HEAD };
    }),
    createReviewItem: jest.fn(async () => {
      calls.push('createReviewItem');
      return reviewItem();
    }),
    updateReviewItem: jest.fn(async ({ item }) => {
      calls.push('updateReviewItem');
      return reviewItem({ id: item.id, url: item.url, ...submitted });
    }),
    readReviewItem: jest.fn(async ({ item }) => {
      calls.push('readReviewItem');
      return reviewItem({ id: item.id, url: item.url, ...readback });
    }),
    approve: jest.fn(async () => calls.push('approve')),
    merge: jest.fn(async () => calls.push('merge')),
    closeIssue: jest.fn(async () => calls.push('closeIssue')),
    calls: () => calls
  };
  return provider;
}

function recordFixture() {
  return {
    provider: 'github',
    repo: 'Dimon94/dverity',
    item: { id: '68', url: 'https://example.test/review/68' },
    source: 'codex/dverity-5-integration',
    target: 'origin/main',
    head: HEAD,
    base: BASE,
    auth_actor: 'fixture-user',
    capability: ['push', 'review-item-write'],
    draft: false,
    approvals: null,
    unresolved_discussions: null,
    mergeability: null,
    protection_or_queue: null,
    ci_state: null,
    current_head_review: null,
    closeout_intent: [{ issue: '#68', action: 'close-after-merge' }],
    mutation_scope: {
      repo: 'Dimon94/dverity',
      source: 'codex/dverity-5-integration',
      target: 'origin/main',
      item: '68',
      allowed: ['push', 'review-item:create-or-update']
    }
  };
}
