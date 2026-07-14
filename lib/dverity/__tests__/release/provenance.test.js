const {
  collectReleaseProvenance,
  assertIntegrationProvenance
} = require('../../release/provenance');

const RELEASE_BASE = '2e468ffca1a45a0481ccf2f7e72b6d2a489951ec';
const RELEASE_MAIN = '5a8225e5346a93864176f4bdfaaa6e03919354ae';
const FROZEN_SOURCE = '537c532191a3508725adf6349e92ceebed4de45f';
const CURRENT_MAIN = '76c2a19470951c4581175ff10a6721014c42965f';
const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);

function providerRun(change = {}) {
  const values = {
    parents: [RELEASE_BASE, FROZEN_SOURCE],
    mergeTree: TREE,
    sourceTree: TREE,
    pull: {
      number: 86,
      merge_commit_sha: RELEASE_MAIN,
      merged_at: '2026-07-14T03:58:00Z',
      base: {
        ref: 'main', sha: RELEASE_BASE,
        repo: { full_name: 'Dimon94/dverity' }
      },
      head: { sha: FROZEN_SOURCE }
    },
    ancestor: true,
    ...change
  };
  return (command, args) => {
    const key = [command, ...args].join(' ');
    const answers = {
      [`git show -s --format=%P ${RELEASE_MAIN}`]: values.parents.join(' '),
      [`git rev-parse ${RELEASE_MAIN}^{tree}`]: values.mergeTree,
      [`git rev-parse ${FROZEN_SOURCE}^{tree}`]: values.sourceTree,
      [`gh api repos/Dimon94/dverity/pulls/86`]: JSON.stringify(values.pull)
    };
    if (key === `git merge-base --is-ancestor ${RELEASE_MAIN} ${CURRENT_MAIN}`
      && !values.ancestor) throw new Error('checkpoint is not an ancestor of current main');
    if (key === `git merge-base --is-ancestor ${RELEASE_MAIN} ${CURRENT_MAIN}`) return '';
    if (!(key in answers)) throw new Error(`unexpected command: ${key}`);
    return answers[key];
  };
}

function integration(change = {}) {
  return {
    branch: 'codex/issue-87-provenance-object',
    base: CURRENT_MAIN,
    head: HEAD,
    commits: [HEAD],
    ...change
  };
}

describe('provider-verified release provenance', () => {
  test('collects one frozen value for provider main, history, and delivered scope', () => {
    const value = collectReleaseProvenance({
      run: providerRun(),
      integration: integration()
    });

    expect(value).toEqual(expect.objectContaining({
      provider: 'github',
      repository: 'Dimon94/dverity',
      main: {
        pull: 86,
        merge: RELEASE_MAIN,
        base: RELEASE_BASE,
        source: FROZEN_SOURCE,
        parents: [RELEASE_BASE, FROZEN_SOURCE],
        trees: { merge: TREE, source: TREE, equal: true }
      }
    }));
    expect(value.integration).toEqual(expect.objectContaining({
      branch: 'codex/issue-87-provenance-object',
      base: CURRENT_MAIN,
      head: HEAD,
      commits: [HEAD]
    }));
    expect(value.integration.history.at(-5)).toEqual(['84', FROZEN_SOURCE]);
    expect(value.integration.history.slice(-4)).toEqual([
      ['79', RELEASE_MAIN],
      ['88', '4b7314f6218eaa3576df3f6ad400b31b478d72c8'],
      ['80', CURRENT_MAIN],
      ['87', HEAD]
    ]);
    expect(value.integration.delivered_issues).toEqual([
      65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 82, 84, 87, 88
    ]);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.main)).toBe(true);
    expect(Object.isFrozen(value.integration.history)).toBe(true);
  });

  test.each([
    ['wrong parent order', { parents: [FROZEN_SOURCE, RELEASE_BASE] }],
    ['squash merge', { parents: [RELEASE_BASE] }],
    ['octopus merge', { parents: [RELEASE_BASE, FROZEN_SOURCE, 'f'.repeat(40)] }],
    ['tree mismatch', { sourceTree: 'f'.repeat(40) }],
    ['PR mismatch', { pull: { number: 86 } }]
  ])('rejects %s', (_name, change) => {
    expect(() => collectReleaseProvenance({ run: providerRun(change) }))
      .toThrow();
  });

  test('rejects provider query failure', () => {
    expect(() => collectReleaseProvenance({
      run: () => { throw new Error('provider unavailable'); }
    })).toThrow(/provider unavailable/);
  });
});

describe('integration provenance', () => {
  function value(change = {}) {
    return collectReleaseProvenance({
      run: providerRun(),
      integration: integration(change)
    });
  }

  test('accepts one clean linear #87 commit on current main', () => {
    expect(assertIntegrationProvenance(value(), {
      dirty: false,
      target_only: 0,
      head_only: 1,
      commit_lines: [`${HEAD} ${CURRENT_MAIN}`]
    })).toEqual(value());
  });

  test.each([
    ['branch drift', { branch: 'codex/other' }],
    ['history drift', { commits: ['f'.repeat(40)] }]
  ])('rejects %s', (_name, change) => {
    expect(() => value(change)).toThrow();
  });

  test('rejects current main outside the provider checkpoint history', () => {
    expect(() => collectReleaseProvenance({
      run: providerRun({ ancestor: false }),
      integration: integration()
    })).toThrow(/not an ancestor/);
  });

  test.each([
    ['dirty worktree', { dirty: true }],
    ['behind target', { target_only: 1 }],
    ['side merge', { commit_lines: [`${HEAD} ${CURRENT_MAIN} ${'f'.repeat(40)}`] }]
  ])('rejects %s', (_name, proof) => {
    expect(() => assertIntegrationProvenance(value(), {
      dirty: false,
      target_only: 0,
      head_only: 1,
      commit_lines: [`${HEAD} ${CURRENT_MAIN}`],
      ...proof
    })).toThrow();
  });
});
