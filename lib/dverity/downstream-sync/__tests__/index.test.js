const fs = require('fs');
const os = require('os');
const path = require('path');
const { DownstreamEntrySchema, runDownstreamSync } = require('..');
const { inspectOwnership, runLifecycle } = require('../../install/lifecycle');

describe('Dverity managed downstream sync', () => {
  test('keeps the repository-owned default allowlist exactly empty', async () => {
    const plan = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../../../config/managed-downstreams.json'),
      'utf8'
    ));
    const dependencies = dependencyFixture();

    expect(plan).toEqual([]);
    await expect(runDownstreamSync({ plan, ...dependencies })).resolves
      .toMatchObject({ success: true, terminal: 'no-op' });
    expect(dependencies.calls()).toEqual([]);
  });

  test('treats the default empty plan as a deterministic zero-call no-op', async () => {
    const dependencies = dependencyFixture();

    const first = await runDownstreamSync({ plan: [], ...dependencies });
    const second = await runDownstreamSync({ plan: [], ...dependencies });

    expect(first).toEqual({
      success: true,
      terminal: 'no-op',
      results: [],
      rollup: { success: 0, fail: 0, blocked: 0, unknown: 0 },
      mutation_audit: { requested: [], performed: [], readback: [] }
    });
    expect(second).toEqual(first);
    expect(dependencies.calls()).toEqual([]);
  });

  test('syncs one explicitly enabled entry only after every authority proof passes', async () => {
    const entry = entryFixture();
    const dependencies = dependencyFixture({ entry });

    const result = await runDownstreamSync({ plan: [entry], ...dependencies });

    expect(result).toEqual({
      success: true,
      terminal: 'completed',
      results: [{
        id: 'docs',
        outcome: 'success',
        readback: {
          provider: 'github',
          repo: 'Dimon94/dverity-docs',
          branch: 'main',
          source_hash: SOURCE_HASH,
          status: 'current',
          receipt: 'sync-1'
        }
      }],
      rollup: { success: 1, fail: 0, blocked: 0, unknown: 0 },
      mutation_audit: {
        requested: [{ entry: 'docs', operation: 'copy-skills' }],
        performed: [{ entry: 'docs', operation: 'copy-skills', receipt: 'sync-1' }],
        readback: [{ entry: 'docs', status: 'current', receipt: 'sync-1' }]
      }
    });
    expect(dependencies.calls()).toEqual([
      'target.read:docs',
      'ownership.readOwnerEvidence:docs',
      'ownership.inspectManifest:/sandbox/dverity-docs',
      'sync:docs',
      'readback:docs'
    ]);
  });

  test('reuses the lifecycle one-root manifest validator in a recorded sandbox', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-downstream-')));
    try {
      runLifecycle('install', { root });
      const manifest = inspectOwnership({ root });
      const entry = entryFixture({
        install_root: root,
        source: {
          version: manifest.package.version,
          hash: manifest.source.hash
        }
      });
      const dependencies = dependencyFixture({ entry });
      delete dependencies.ownership.inspectManifest;

      const result = await runDownstreamSync({ plan: [entry], ...dependencies });

      expect(result).toMatchObject({
        success: true,
        results: [{ id: 'docs', outcome: 'success' }]
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['authenticated target', (dependencies, entry) => {
      dependencies.target.read.mockResolvedValue({
        ...entry.target,
        auth_actor: null,
        capability: ['downstream-sync']
      });
    }],
    ['downstream-sync capability', (dependencies, entry) => {
      dependencies.target.read.mockResolvedValue({
        ...entry.target,
        auth_actor: 'sandbox-owner',
        capability: []
      });
    }],
    ['owner evidence', (dependencies, entry) => {
      dependencies.ownership.readOwnerEvidence.mockResolvedValue({
        ...entry.owner_evidence,
        verified: false
      });
    }],
    ['one-root manifest', (dependencies, entry) => {
      dependencies.ownership.inspectManifest.mockReturnValue({
        package: { name: 'dverity', version: entry.source.version },
        source: { hash: '0'.repeat(64) },
        projections: [{ root: '.agents/skills' }, { root: '.claude/skills' }]
      });
    }],
    ['named sync method', (dependencies) => {
      delete dependencies.syncMethods['copy-skills'];
    }]
  ])('blocks an entry missing %s with zero mutation', async (_name, removeProof) => {
    const entry = entryFixture();
    const dependencies = dependencyFixture({ entry });
    removeProof(dependencies, entry);

    const result = await runDownstreamSync({ plan: [entry], ...dependencies });

    expect(result).toMatchObject({
      success: false,
      results: [{ id: 'docs', outcome: 'blocked' }],
      rollup: { success: 0, fail: 0, blocked: 1, unknown: 0 },
      mutation_audit: { requested: [], performed: [], readback: [] }
    });
    expect(dependencies.calls().some((call) => call.startsWith('sync:'))).toBe(false);
    expect(dependencies.calls().some((call) => call.startsWith('readback:'))).toBe(false);
  });

  test('never turns an external search-only hit into a sync plan', async () => {
    const dependencies = dependencyFixture();
    dependencies.search = jest.fn(() => [{ repo: 'Dimon94/dverity-docs' }]);

    const result = await runDownstreamSync({ plan: [], ...dependencies });

    expect(result.terminal).toBe('no-op');
    expect(dependencies.search).not.toHaveBeenCalled();
    expect(dependencies.calls()).toEqual([]);
  });

  test('disabling or removing an entry stops future sync without remote deletion', async () => {
    const entry = entryFixture();
    const removedDependencies = dependencyFixture({ entry });
    await runDownstreamSync({ plan: [entry], ...removedDependencies });
    const callsAfterSync = [...removedDependencies.calls()];

    const removed = await runDownstreamSync({ plan: [], ...removedDependencies });

    expect(removed.terminal).toBe('no-op');
    expect(removedDependencies.calls()).toEqual(callsAfterSync);
    expect(removedDependencies.deleteRemote).not.toHaveBeenCalled();

    const disabledEntry = entryFixture({ enabled: false });
    const disabledDependencies = dependencyFixture({ entry: disabledEntry });
    const disabled = await runDownstreamSync({ plan: [disabledEntry], ...disabledDependencies });

    expect(disabled).toMatchObject({
      success: false,
      results: [{ id: 'docs', outcome: 'blocked', reason: 'entry is disabled' }],
      mutation_audit: { requested: [], performed: [], readback: [] }
    });
    expect(disabledDependencies.calls()).toEqual([]);
    expect(disabledDependencies.deleteRemote).not.toHaveBeenCalled();
  });

  test('keeps success, fail, blocked, and unknown outcomes independent per entry', async () => {
    const entries = ['success', 'fail', 'blocked', 'unknown'].map((id) => entryFixture({
      id,
      target: { provider: 'github', repo: `Dimon94/${id}`, branch: 'main' },
      install_root: `/sandbox/${id}`
    }));
    const dependencies = dependencyFixture();
    dependencies.ownership.readOwnerEvidence.mockImplementation(async (entry) => {
      dependencies.calls().push(`ownership.readOwnerEvidence:${entry.id}`);
      return { ...entry.owner_evidence, verified: entry.id !== 'blocked' };
    });
    dependencies.syncMethods['copy-skills'].mockImplementation(async ({ entry }) => {
      dependencies.calls().push(`sync:${entry.id}`);
      if (entry.id === 'fail') throw new Error('recorded sandbox sync failed');
      return { operation: entry.sync.method, receipt: `sync-${entry.id}` };
    });
    dependencies.readbackMethods['tree-hash'].mockImplementation(async ({ entry, receipt }) => {
      dependencies.calls().push(`readback:${entry.id}`);
      if (entry.id === 'unknown') throw new Error('recorded readback unavailable');
      return {
        ...entry.target,
        source_hash: entry.source.hash,
        status: 'current',
        receipt: receipt.receipt
      };
    });

    const result = await runDownstreamSync({ plan: entries, ...dependencies });

    expect(result).toMatchObject({
      success: false,
      terminal: 'completed',
      results: [
        { id: 'success', outcome: 'success' },
        { id: 'fail', outcome: 'fail', reason: 'recorded sandbox sync failed' },
        { id: 'blocked', outcome: 'blocked' },
        { id: 'unknown', outcome: 'unknown', reason: 'recorded readback unavailable' }
      ],
      rollup: { success: 1, fail: 1, blocked: 1, unknown: 1 }
    });
    expect(result.mutation_audit.requested.map(({ entry }) => entry))
      .toEqual(['success', 'fail', 'unknown']);
    expect(result.mutation_audit.performed.map(({ entry }) => entry))
      .toEqual(['success', 'unknown']);
    expect(result.mutation_audit.readback.map(({ entry }) => entry)).toEqual(['success']);
  });

  test('rejects undeclared schema fields before any authority read', async () => {
    const entry = { ...entryFixture(), discovered_by_search: true };
    const dependencies = dependencyFixture({ entry });

    expect(DownstreamEntrySchema.safeParse(entry).success).toBe(false);
    await expect(runDownstreamSync({ plan: [entry], ...dependencies })).rejects
      .toThrow(/unrecognized key/i);
    expect(dependencies.calls()).toEqual([]);
  });
});

const SOURCE_HASH = 'f'.repeat(64);

function entryFixture(overrides = {}) {
  return {
    id: 'docs',
    enabled: true,
    target: {
      provider: 'github',
      repo: 'Dimon94/dverity-docs',
      branch: 'main'
    },
    install_root: '/sandbox/dverity-docs',
    hosts: ['agents', 'claude'],
    owner_evidence: {
      uri: 'https://example.test/ownership/docs',
      sha256: 'e'.repeat(64)
    },
    source: { version: '5.0.0', hash: SOURCE_HASH },
    sync: { method: 'copy-skills' },
    readback: { method: 'tree-hash' },
    ...overrides
  };
}

function dependencyFixture({ entry = entryFixture() } = {}) {
  const calls = [];
  return {
    calls: () => calls,
    deleteRemote: jest.fn(() => calls.push('deleteRemote')),
    target: {
      read: jest.fn(async (actual) => {
        calls.push(`target.read:${actual.id}`);
        return {
          ...actual.target,
          auth_actor: 'sandbox-owner',
          capability: ['downstream-sync']
        };
      })
    },
    ownership: {
      readOwnerEvidence: jest.fn(async (actual) => {
        calls.push(`ownership.readOwnerEvidence:${actual.id}`);
        return { ...actual.owner_evidence, verified: true };
      }),
      inspectManifest: jest.fn((root) => {
        calls.push(`ownership.inspectManifest:${root}`);
        return {
          package: { name: 'dverity', version: '5.0.0' },
          source: { hash: SOURCE_HASH },
          projections: [{ root: '.agents/skills' }, { root: '.claude/skills' }]
        };
      })
    },
    syncMethods: {
      'copy-skills': jest.fn(async ({ entry: actual }) => {
        calls.push(`sync:${actual.id}`);
        return { operation: 'copy-skills', receipt: 'sync-1' };
      })
    },
    readbackMethods: {
      'tree-hash': jest.fn(async ({ entry: actual }) => {
        calls.push(`readback:${actual.id}`);
        return {
          ...actual.target,
          source_hash: actual.source.hash,
          status: 'current',
          receipt: 'sync-1'
        };
      })
    }
  };
}
