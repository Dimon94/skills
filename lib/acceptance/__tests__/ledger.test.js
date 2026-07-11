const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const catalog = require('../../../acceptance/catalog.json');
const {
  canDeclareReleaseSuccess,
  generateAcceptancePacket,
  validateCatalog,
  validateTruthToMainContract
} = require('../ledger.js');

const CANONICAL_ACCEPTANCE_COUNT = 55;

describe('Dverity acceptance foundation', () => {
  test('accepts the one canonical Truth-to-Main chain', () => {
    const contract = fs.readFileSync(path.join(ROOT, 'DVERITY.md'), 'utf8');

    expect(validateTruthToMainContract(truthToMainCorpus(contract))).toEqual({
      success: true,
      chain: [
        'Repair',
        'Verified Local',
        'Submit',
        'Review Ready',
        'Merge',
        'Verified Remote Main'
      ],
      repair_terminal: 'Verified Local',
      wayfinder_entry: 'Submit',
      remote_promotion: 'explicit'
    });
  });

  test('accepts exactly the 55 canonical acceptance rows', () => {
    const result = validateCatalog(catalog);

    expect(result.success).toBe(true);
    expect(result.data.rows).toHaveLength(CANONICAL_ACCEPTANCE_COUNT);
    expect(new Set(result.data.rows.map((row) => row.acceptance_id)).size)
      .toBe(CANONICAL_ACCEPTANCE_COUNT);
  });

  test.each([
    ['duplicate', (rows) => [...rows, rows[0]]],
    ['missing', (rows) => rows.slice(1)],
    [
      'unexpected',
      (rows) => [{ ...rows[0], acceptance_id: 'DV-EXTRA-001' }, ...rows.slice(1)]
    ]
  ])('rejects a %s acceptance ID', (_name, mutate) => {
    const result = validateCatalog({ ...catalog, rows: mutate(catalog.rows) });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/canonical acceptance ID set|duplicate/i);
  });

  test.each([
    ['fail_or_blocked_condition', 'failure condition'],
    ['false_green_prevented', 'false-green'],
    ['freshness_keys', 'freshness'],
    ['mutation_authority', 'authority'],
    ['owner', 'owner']
  ])('rejects a row without %s semantics', (field, message) => {
    const invalidValue = field === 'freshness_keys' ? [] : '';
    const rows = [{ ...catalog.rows[0], [field]: invalidValue }, ...catalog.rows.slice(1)];

    const result = validateCatalog({ ...catalog, rows });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(new RegExp(message, 'i'));
  });

  test('rejects a row that is not required', () => {
    const rows = [{ ...catalog.rows[0], required: false }, ...catalog.rows.slice(1)];

    const result = validateCatalog({ ...catalog, rows });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  test('rejects a local row without its canonical executor', () => {
    const rows = [{ ...catalog.rows[0], executor: undefined }, ...catalog.rows.slice(1)];

    const result = validateCatalog({ ...catalog, rows });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/canonical executor/i);
  });

  test.each([
    ['DV-OWN-002', 'verify fails closed for a missing ownership manifest without mutation'],
    ['DV-OWN-003', 'global and project scopes remain isolated in disposable roots'],
    ['DV-OWN-004', 'forged marker remains unchanged and gains no ownership claim'],
    ['DV-MIG-006', 'preserving Unknown and reporting external refs']
  ])('binds %s to its own observable predicate', (acceptanceId, predicate) => {
    const row = catalog.rows.find((entry) => entry.acceptance_id === acceptanceId);

    expect(row.executor.assertions.some(({ full_name: fullName }) => fullName.includes(predicate)))
      .toBe(true);
  });

  test('generates pending rows for unregistered executors', () => {
    const result = generateAcceptancePacket({
      catalog,
      metadata: packetMetadata(),
      results: []
    });

    expect(result.success).toBe(true);
    expect(result.data.results).toHaveLength(CANONICAL_ACCEPTANCE_COUNT);
    expect(result.data.rollup).toEqual({
      pass: 0,
      fail: 0,
      blocked: 0,
      unknown: 0,
      pending: CANONICAL_ACCEPTANCE_COUNT
    });
    expect(canDeclareReleaseSuccess(result.data)).toBe(false);
    expect(JSON.stringify(result.data)).not.toContain('skipped');
  });

  test.each(['fail', 'blocked', 'unknown', 'pending'])(
    'does not declare release success when one result is %s',
    (outcome) => {
      const results = catalog.rows.map((row) => acceptanceResult(row.acceptance_id));
      results[0] = acceptanceResult(results[0].acceptance_id, outcome);

      const packet = generateAcceptancePacket({
        catalog,
        metadata: packetMetadata(),
        results
      });

      expect(packet.success).toBe(true);
      expect(packet.data.rollup[outcome]).toBe(1);
      expect(canDeclareReleaseSuccess(packet.data)).toBe(false);
    }
  );

  test('declares success only when every canonical result passes', () => {
    const packet = generateAcceptancePacket({
      catalog,
      metadata: packetMetadata(),
      results: catalog.rows.map((row) => acceptanceResult(row.acceptance_id))
    });

    expect(packet.success).toBe(true);
    expect(packet.data.rollup).toEqual({
      pass: CANONICAL_ACCEPTANCE_COUNT,
      fail: 0,
      blocked: 0,
      unknown: 0,
      pending: 0
    });
    expect(canDeclareReleaseSuccess(packet.data)).toBe(true);
  });

  test('rejects skipped, duplicate, and unexpected executor results', () => {
    const first = acceptanceResult(catalog.rows[0].acceptance_id);

    for (const results of [
      [{ ...first, outcome: 'skipped' }],
      [first, first],
      [acceptanceResult('DV-EXTRA-001')]
    ]) {
      const packet = generateAcceptancePacket({
        catalog,
        metadata: packetMetadata(),
        results
      });
      expect(packet.success).toBe(false);
    }
  });

  test.each([
    '```text\nRepair -> Verified Local -> Submit -> Review Ready -> Merge -> Verified Remote Main\n```',
    'Current route: Repair -> Verified Local -> Submit -> Review Ready -> Merge -> Verified Remote Main'
  ])('rejects a second full chain in another current surface', (duplicate) => {
    const contract = fs.readFileSync(path.join(ROOT, 'DVERITY.md'), 'utf8');
    const result = validateTruthToMainContract(truthToMainCorpus(contract, [{
      path: 'README.md',
      content: duplicate
    }]));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/full visible chain must exist only/i);
  });

  test('rejects wrong route markers', () => {
    const contract = fs.readFileSync(path.join(ROOT, 'DVERITY.md'), 'utf8')
      .replace('dverity:repair-terminal Verified Local', 'dverity:repair-terminal remote')
      .replace('dverity:wayfinder-entry Submit', 'dverity:wayfinder-entry Repair');
    const result = validateTruthToMainContract(truthToMainCorpus(contract));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Repair must default to Verified Local/i);
    expect(result.error).toMatch(/Wayfinder must enter at Submit/i);
  });

  test.each([
    'Repair automatically promotes to Submit.',
    'Repair sends every verified fix to Submit without asking authority.',
    'Repair must not stop at Verified Local and sends every fix to Submit.'
  ])('rejects implicit remote promotion prose', (content) => {
    const contract = fs.readFileSync(path.join(ROOT, 'DVERITY.md'), 'utf8');
    const result = validateTruthToMainContract(truthToMainCorpus(contract, [{
      path: 'skills/dverity-repair/SKILL.md',
      content
    }]));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/explicit authority/i);
  });

  test.each([
    'Repair does not send fixes to Submit automatically.',
    'Repair never promotes work to Submit.'
  ])('accepts an explicitly denied remote promotion', (content) => {
    const contract = fs.readFileSync(path.join(ROOT, 'DVERITY.md'), 'utf8');
    const result = validateTruthToMainContract(truthToMainCorpus(contract, [{
      path: 'skills/dverity-repair/SKILL.md',
      content
    }]));

    expect(result.success).toBe(true);
  });
});

function truthToMainCorpus(contract, surfaces = []) {
  return {
    owner: { path: 'DVERITY.md', content: contract },
    surfaces
  };
}

function packetMetadata() {
  return {
    run_id: 'run-001',
    created_at: '2026-07-11T00:00:00.000Z',
    repo: 'Dimon94/dverity',
    source_commit: 'a'.repeat(40),
    artifact: {
      name: 'dverity-5.0.0.tgz',
      sha512: 'b'.repeat(128),
      npm_integrity: 'sha512-example'
    },
    environment: {
      node: 'v22.0.0',
      npm: '10.0.0',
      os: 'darwin',
      host_versions: {}
    }
  };
}

function acceptanceResult(acceptanceId, outcome = 'pass') {
  return {
    acceptance_id: acceptanceId,
    outcome,
    started_at: '2026-07-11T00:00:00.000Z',
    finished_at: '2026-07-11T00:00:01.000Z',
    freshness: { verified: true },
    authority: { verified: true },
    evidence_refs: [{
      kind: 'transient-log',
      uri: 'artifact://acceptance/run-001.log',
      sha256: 'c'.repeat(64)
    }],
    mutation: {
      before_gate: null,
      requested: [],
      performed: [],
      readback: [],
      rollback_or_fix_forward_boundary: null
    }
  };
}
