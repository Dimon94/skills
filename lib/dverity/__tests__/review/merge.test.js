const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  carryForwardReview,
  collectCarryForwardEvidence,
  reviewMergeItem,
  routeMergeWork
} = require('../../review/merge');
const { sameTextSet } = require('../../review/review-item-record');

describe('Dverity Merge review gate', () => {
  test.each([
    ['bare branch', { kind: 'branch', name: 'codex/work' }],
    ['remote task', { kind: 'remote-task', id: 'task-69' }],
    ['missing item', { kind: 'provider-item', record: null }]
  ])('reroutes a %s to Submit without provider mutation', async (_name, candidate) => {
    const provider = providerFixture();

    const result = await reviewMergeItem({ candidate, provider });

    expect(result).toMatchObject({
      success: false,
      terminal: 'reroute',
      target: 'submit-remote-review',
      remote_actions_performed: []
    });
    expect(provider.calls()).toEqual([]);
  });

  test('creates a fresh immutable current-head Independent Review with read-only calls', async () => {
    const provider = providerFixture({ record: reviewItemRecord() });
    const reviewer = reviewerFixture();
    const candidateRecord = reviewItemRecord({ current_head_review: null });

    const result = await reviewMergeItem({
      candidate: { kind: 'provider-item', record: candidateRecord },
      provider,
      reviewer,
      task_session: 'review-session-69'
    });

    expect(result).toMatchObject({
      success: true,
      terminal: 'independent-review-passed',
      remote_actions_performed: []
    });
    expect(result.record.current_head_review).toEqual(reviewRecord());
    expect(result.record).not.toBe(candidateRecord);
    expect(candidateRecord.current_head_review).toBeNull();
    expect(Object.isFrozen(result.record)).toBe(true);
    expect(Object.isFrozen(result.record.current_head_review)).toBe(true);
    expect(provider.calls()).toEqual(['readReviewItem']);
    expect(reviewer.calls()).toEqual(['review']);
    expect(provider.readReviewItem).toHaveBeenCalledWith(expect.objectContaining({
      repo: 'Dimon94/dverity',
      item: { id: '69', url: 'https://example.test/review/69' },
      read_only: true
    }));
    expect(reviewer.review).toHaveBeenCalledWith(expect.objectContaining({
      task_session: 'review-session-69',
      read_only: true
    }));
  });

  test.each([
    ['head', { head: 'c'.repeat(40) }],
    ['task session', { task_session: 'stale-session' }],
    ['provider', { provider: 'gitlab' }],
    ['item', { item: { id: '70', url: 'https://example.test/review/70' } }]
  ])('blocks a review bound to the wrong %s', async (_name, review) => {
    const result = await reviewMergeItem({
      candidate: { kind: 'provider-item', record: reviewItemRecord() },
      provider: providerFixture({ record: reviewItemRecord() }),
      reviewer: reviewerFixture({ review }),
      task_session: 'review-session-69'
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(/current item, head, and task session/i);
  });

  test.each([
    'approvals',
    'unresolved_discussions',
    'mergeability',
    'protection_or_queue',
    'ci_state'
  ])('blocks missing current provider truth for %s before review', async (field) => {
    const reviewer = reviewerFixture();
    const result = await reviewMergeItem({
      candidate: { kind: 'provider-item', record: reviewItemRecord() },
      provider: providerFixture({ record: reviewItemRecord({ [field]: null }) }),
      reviewer,
      task_session: 'review-session-69'
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(new RegExp(field));
    expect(reviewer.calls()).toEqual([]);
  });

  test('blocks a provider readback without authenticated review-item-read capability', async () => {
    const reviewer = reviewerFixture();
    const result = await reviewMergeItem({
      candidate: { kind: 'provider-item', record: reviewItemRecord() },
      provider: providerFixture({
        record: reviewItemRecord({ capability: ['unrelated-capability'] })
      }),
      reviewer,
      task_session: 'review-session-69'
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(/review-item-read capability/i);
    expect(reviewer.calls()).toEqual([]);
  });

  test('blocks provider readback whose mutation scope is not bound to the item', async () => {
    const result = await reviewMergeItem({
      candidate: { kind: 'provider-item', record: reviewItemRecord() },
      provider: providerFixture({
        record: reviewItemRecord({
          mutation_scope: {
            ...reviewItemRecord().mutation_scope,
            item: '70'
          }
        })
      }),
      reviewer: reviewerFixture(),
      task_session: 'review-session-69'
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(/mutation scope/i);
  });

  test('blocks Independent Review that reuses the prior task session', async () => {
    const reviewer = reviewerFixture();
    const result = await reviewMergeItem({
      candidate: { kind: 'provider-item', record: reviewItemRecord() },
      provider: providerFixture({
        record: reviewItemRecord({ current_head_review: reviewRecord() })
      }),
      reviewer,
      task_session: 'review-session-69'
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(/fresh task session/i);
    expect(reviewer.calls()).toEqual([]);
  });

  test('blocks a task session already present only in the submitted record', async () => {
    const reviewer = reviewerFixture();
    const result = await reviewMergeItem({
      candidate: {
        kind: 'provider-item',
        record: reviewItemRecord({ current_head_review: reviewRecord() })
      },
      provider: providerFixture({ record: reviewItemRecord() }),
      reviewer,
      task_session: 'review-session-69'
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(/fresh task session/i);
    expect(reviewer.calls()).toEqual([]);
  });

  test('blocks a reviewer that tries to rewrite provider current-head truth', async () => {
    const providerHead = HEAD;
    const forgedHead = 'c'.repeat(40);
    const reviewer = {
      review: jest.fn(async ({ record }) => {
        record.head = forgedHead;
        return reviewRecord({ head: forgedHead });
      })
    };

    const result = await reviewMergeItem({
      candidate: { kind: 'provider-item', record: reviewItemRecord() },
      provider: providerFixture({ record: reviewItemRecord({ head: providerHead }) }),
      reviewer,
      task_session: 'review-session-69'
    });

    expect(result).toMatchObject({ success: false, terminal: 'blocked' });
    expect(result.reason).toMatch(/current item, head, and task session/i);
    expect(reviewer.review).toHaveBeenCalledTimes(1);
  });

  test('treats an old-head verdict as stale and runs a fresh review for the current head', async () => {
    const newHead = 'c'.repeat(40);
    const oldRecord = reviewItemRecord({ current_head_review: reviewRecord() });
    const provider = providerFixture({ record: reviewItemRecord({ head: newHead }) });
    const reviewer = reviewerFixture({
      review: { head: newHead, task_session: 'fresh-review-session-70' }
    });

    const result = await reviewMergeItem({
      candidate: { kind: 'provider-item', record: oldRecord },
      provider,
      reviewer,
      task_session: 'fresh-review-session-70'
    });

    expect(result.success).toBe(true);
    expect(result.record.head).toBe(newHead);
    expect(result.record.current_head_review).toMatchObject({
      head: newHead,
      mode: 'fresh',
      carried_from: null
    });
    expect(oldRecord.head).toBe(HEAD);
    expect(reviewer.calls()).toEqual(['review']);
  });
});

describe('Dverity review freshness', () => {
  test('compares touched paths as an order-independent set', () => {
    expect(sameTextSet(['a.js', 'b.js'], ['b.js', 'a.js'])).toBe(true);
    expect(sameTextSet(['a.js'], ['b.js'])).toBe(false);
  });

  test('collects semantic-no-op proof from real Git commands and new-head validation', () => {
    const repo = semanticNoopRepo();
    const validationRunner = jest.fn(() => ({
      head: repo.newHead,
      command: 'node validate-new-head.js',
      exit_code: 0,
      stdout: 'pass\n',
      stderr: ''
    }));

    const evidence = collectCarryForwardEvidence({
      repo_path: repo.root,
      old_base: repo.oldBase,
      old_head: repo.oldHead,
      new_base: repo.newBase,
      new_head: repo.newHead,
      validation_runner: validationRunner,
      materiality: noMaterialChange()
    });

    expect(evidence.range_diff).toMatchObject({ exit_code: 0 });
    expect(evidence.range_diff.entries.every((entry) => entry.status === '=')).toBe(true);
    expect(evidence.patch_ids.old).toEqual(evidence.patch_ids.new);
    expect(evidence.trees.old).toBe(evidence.trees.new);
    expect(evidence.paths.old).toEqual(evidence.paths.new);
    expect(evidence.validation).toMatchObject({ head: repo.newHead, exit_code: 0 });
    expect(validationRunner).toHaveBeenCalledWith({ cwd: repo.root, head: repo.newHead });
  });

  test('creates a new carry-forward record only from complete semantic-no-op proof', () => {
    const repo = semanticNoopRepo();
    const previous = reviewItemRecord({
      base: repo.oldBase,
      head: repo.oldHead,
      current_head_review: reviewRecord({ head: repo.oldHead })
    });
    const current = reviewItemRecord({
      base: repo.newBase,
      head: repo.newHead,
      current_head_review: null
    });

    const result = carryForwardReview({
      previous_record: previous,
      current_record: current,
      task_session: 'carry-session-69',
      repo_path: repo.root,
      validation_runner: passingValidation(repo.newHead),
      materiality: noMaterialChange()
    });

    expect(result).toMatchObject({
      success: true,
      terminal: 'review-carry-forward-passed',
      remote_actions_performed: []
    });
    expect(result.record).not.toBe(previous);
    expect(result.record).not.toBe(current);
    expect(result.record.current_head_review).toMatchObject({
      provider: 'github',
      repo: 'Dimon94/dverity',
      item: { id: '69', url: 'https://example.test/review/69' },
      head: repo.newHead,
      task_session: 'carry-session-69',
      facets: ['standards', 'spec'],
      findings: [],
      verdict: 'pass',
      mode: 'carry-forward',
      carried_from: repo.oldHead,
      read_only: true
    });
    expect(previous.current_head_review.mode).toBe('fresh');
    expect(current.current_head_review).toBeNull();
    expect(Object.isFrozen(result.record)).toBe(true);
  });

  test.each([
    ['provider', { provider: 'gitlab' }],
    ['repo', { repo: 'other/repo' }],
    ['item', { item: { id: '70', url: 'https://example.test/review/70' } }]
  ])('rejects carry-forward from a review bound to another %s', (_name, review) => {
    const previous = reviewItemRecord({
      current_head_review: reviewRecord(review)
    });

    const result = carryForwardFixture({ previous_record: previous });

    expect(result).toMatchObject({
      success: false,
      terminal: 'blocked',
      next_owner: 'independent-review'
    });
  });

  test('rejects carry-forward that reuses the old review task session', () => {
    const result = carryForwardFixture({ task_session: 'review-session-69' });

    expect(result).toMatchObject({
      success: false,
      terminal: 'blocked',
      next_owner: 'independent-review'
    });
    expect(result.reason).toMatch(/fresh task session/i);
  });

  test.each(['conflict', 'content', 'generated', 'bug_fix', 'unknown'])(
    'requires fresh Independent Review for a %s change',
    (kind) => {
      const result = carryForwardFixture({
        materiality: noMaterialChange({ [kind]: true })
      });

      expect(result).toMatchObject({
        success: false,
        terminal: 'blocked',
        next_owner: 'independent-review',
        remote_actions_performed: []
      });
    }
  );

  test.each([
    ['material Git patch', {
      repo: () => semanticNoopRepo({ newContent: 'different change\n' })
    }],
    ['failed new-head validation', {
      validation: (repo) => jest.fn(() => ({
        head: repo.newHead,
        command: 'node validate-new-head.js',
        exit_code: 1,
        stdout: '',
        stderr: 'fail\n'
      }))
    }],
    ['validation bound to another head', {
      validation: () => passingValidation('f'.repeat(40))
    }],
    ['missing validation runner', {
      validation: () => null
    }]
  ])('requires fresh Independent Review for %s', (_name, fixture) => {
    const repo = fixture.repo ? fixture.repo() : semanticNoopRepo();
    const validationRunner = fixture.validation
      ? fixture.validation(repo)
      : passingValidation(repo.newHead);
    const result = carryForwardFixture({ repo, validation_runner: validationRunner });

    expect(result).toMatchObject({
      success: false,
      terminal: 'blocked',
      next_owner: 'independent-review'
    });
  });
});

describe('Dverity Merge reroutes', () => {
  test.each([
    [
      { kind: 'conflict', intent_status: 'proven', evidence_status: 'confirmed' },
      { status: 'route', target: 'resolving-merge-conflicts' }
    ],
    [
      { kind: 'conflict', intent_status: 'ambiguous', evidence_status: 'unknown' },
      { status: 'blocked', target: null }
    ],
    [
      { kind: 'confirmed-defect', intent_status: 'proven', evidence_status: 'confirmed' },
      { status: 'route', target: 'dverity-repair' }
    ],
    [
      { kind: 'confirmed-defect', intent_status: 'proven', evidence_status: 'corroborated' },
      { status: 'blocked', target: null }
    ],
    [
      { kind: 'feature-gap', intent_status: 'proven', evidence_status: 'confirmed' },
      { status: 'route', target: 'external-wayfinder-executor' }
    ],
    [
      { kind: 'requirement-change', intent_status: 'proven', evidence_status: 'confirmed' },
      { status: 'route', target: 'external-wayfinder-executor' }
    ],
    [
      { kind: 'missing-intent', intent_status: 'unknown', evidence_status: 'unknown' },
      { status: 'blocked', target: null }
    ]
  ])('routes merge work to the sole owner', (signal, expected) => {
    expect(routeMergeWork(signal)).toEqual({
      ...expected,
      product_mutations_performed: []
    });
  });
});

const HEAD = 'b'.repeat(40);
const BASE = 'a'.repeat(40);

function providerFixture({ record } = {}) {
  const calls = [];
  return {
    readReviewItem: jest.fn(async () => {
      calls.push('readReviewItem');
      return record;
    }),
    calls: () => calls
  };
}

function reviewerFixture({ review = {} } = {}) {
  const calls = [];
  return {
    review: jest.fn(async () => {
      calls.push('review');
      return reviewRecord(review);
    }),
    calls: () => calls
  };
}

function reviewRecord(overrides = {}) {
  return {
    schema_version: 1,
    provider: 'github',
    repo: 'Dimon94/dverity',
    item: { id: '69', url: 'https://example.test/review/69' },
    head: HEAD,
    task_session: 'review-session-69',
    facets: ['standards', 'spec'],
    findings: [],
    verdict: 'pass',
    mode: 'fresh',
    carried_from: null,
    read_only: true,
    ...overrides
  };
}

function reviewItemRecord(overrides = {}) {
  return {
    provider: 'github',
    repo: 'Dimon94/dverity',
    item: { id: '69', url: 'https://example.test/review/69' },
    source: 'codex/dverity-5-integration',
    target: 'origin/main',
    head: HEAD,
    base: BASE,
    auth_actor: 'fixture-user',
    capability: ['review-item-read'],
    draft: false,
    approvals: { state: 'approved' },
    unresolved_discussions: [],
    mergeability: { state: 'mergeable' },
    protection_or_queue: { state: 'direct' },
    ci_state: { state: 'passed' },
    current_head_review: null,
    closeout_intent: [{ issue: '#69', action: 'close-after-merge' }],
    mutation_scope: {
      repo: 'Dimon94/dverity',
      source: 'codex/dverity-5-integration',
      target: 'origin/main',
      item: '69',
      allowed: ['review', 'land']
    },
    ...overrides
  };
}

function carryForwardFixture({
  repo = semanticNoopRepo(),
  previous_record: previousRecord = reviewItemRecord({
    base: repo.oldBase,
    head: repo.oldHead,
    current_head_review: reviewRecord({ head: repo.oldHead })
  }),
  task_session: taskSession = 'carry-session-69',
  validation_runner: validationRunner = passingValidation(repo.newHead),
  materiality = noMaterialChange()
} = {}) {
  return carryForwardReview({
    previous_record: previousRecord,
    current_record: reviewItemRecord({
      base: repo.newBase,
      head: repo.newHead,
      current_head_review: null
    }),
    task_session: taskSession,
    repo_path: repo.root,
    validation_runner: validationRunner,
    materiality
  });
}

function git(root, args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function semanticNoopRepo({ newContent = 'same change\n', newPath = 'change.txt' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-carry-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Dverity Test']);
  git(root, ['config', 'user.email', 'dverity@example.test']);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, ['add', 'base.txt']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);

  git(root, ['switch', '--quiet', '-c', 'old-series']);
  fs.writeFileSync(path.join(root, 'change.txt'), 'same change\n');
  git(root, ['add', 'change.txt']);
  git(root, ['commit', '--quiet', '-m', 'same change'], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
    }
  });
  const oldHead = git(root, ['rev-parse', 'HEAD']);

  git(root, ['switch', '--quiet', '-c', 'new-series', base]);
  fs.writeFileSync(path.join(root, newPath), newContent);
  git(root, ['add', newPath]);
  git(root, ['commit', '--quiet', '-m', 'same change'], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:01Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z'
    }
  });
  const newHead = git(root, ['rev-parse', 'HEAD']);
  return { root, oldBase: base, oldHead, newBase: base, newHead };
}

function passingValidation(head) {
  return jest.fn(() => ({
    head,
    command: 'node validate-new-head.js',
    exit_code: 0,
    stdout: 'pass\n',
    stderr: ''
  }));
}

function noMaterialChange(overrides = {}) {
  return {
    conflict: false,
    content: false,
    generated: false,
    bug_fix: false,
    unknown: false,
    ...overrides
  };
}
