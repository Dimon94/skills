const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  MIGRATION_FAULT_POINTS,
  MIGRATION_SCHEMA,
  resolveScope,
  runLifecycle
} = require('../../lifecycle');
const { mirrorSkillDirectoriesForPlatform } = require('../../../compiler/resource-copier');

const ROOT = path.resolve(__dirname, '../../../..');
const CLI = path.join(ROOT, 'bin', 'dverity-cli.js');
const LEGACY_COMMIT = '257af9a5b2c8637bc1c89320c3c3b72bac3569f8';
const LEGACY_SKILL_IDS = [
  'cc-act',
  'cc-archive',
  'cc-check',
  'cc-dev',
  'cc-diagnose',
  'cc-do',
  'cc-next',
  'cc-plan',
  'cc-pr-land',
  'cc-pr-review',
  'cc-research',
  'cc-review',
  'cc-simplify',
  'do-not-repeat-yourself',
  'execution-environment-contract',
  'postmortem',
  'quality-gate-contract',
  'task-contract',
  'workflow-chain-contract'
];
const DVERITY_SKILL_IDS = [
  'do-not-repeat-yourself',
  'dverity-repair',
  'dverity-research',
  'dverity-simplify',
  'git-commit',
  'merge-remote-review',
  'postmortem',
  'resolving-merge-conflicts',
  'submit-remote-review'
];
const PRESERVED_SKILL_IDS = [
  'docs-sync',
  'managed-skill-sync',
  'npm-release',
  'skill-authoring-gate'
];
const DATA_FAULT_POINTS = MIGRATION_FAULT_POINTS.filter((point) => (
  /(?:^|:)(?:data|stage-postmortems|stage-research|retire-postmortems|retire-research|prepare-docs|publish-postmortems|publish-research)$/.test(point)
));

function tempRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-migrate-')));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8'
  });
}

function snapshot(root) {
  function visit(target) {
    if (!fs.existsSync(target)) return ['missing'];
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return ['link', fs.readlinkSync(target)];
    if (stat.isFile()) return ['file', fs.readFileSync(target)];
    return ['dir', ...fs.readdirSync(target).sort().flatMap((entry) => [
      entry,
      ...visit(path.join(target, entry))
    ])];
  }
  const hash = crypto.createHash('sha256');
  for (const part of visit(root)) hash.update(part);
  return hash.digest('hex');
}

function migrationState(root, original) {
  const old = original
    && snapshot(path.join(root, '.codex')) === original.codex
    && snapshot(path.join(root, '.claude')) === original.claude
    && !fs.existsSync(path.join(root, '.agents'))
    && !fs.existsSync(path.join(root, '.dverity/managed-skills.json'));
  const modern = !fs.existsSync(path.join(root, '.codex'))
    && fs.existsSync(path.join(root, '.dverity/managed-skills.json'))
    && ['.agents/skills', '.claude/skills'].every((projection) => {
      const entries = fs.readdirSync(path.join(root, projection));
      return DVERITY_SKILL_IDS.every((skill) => entries.includes(skill));
    })
    && LEGACY_SKILL_IDS.filter((skill) => !DVERITY_SKILL_IDS.includes(skill))
      .every((skill) => !fs.existsSync(path.join(root, '.claude/skills', skill)));
  if (old === modern) return 'mixed';
  const dverityEntries = fs.existsSync(path.join(root, '.dverity'))
    ? fs.readdirSync(path.join(root, '.dverity')).sort()
    : [];
  if (dverityEntries.some((entry) => entry === 'transactions')) return 'mixed';
  return old ? 'old' : 'dverity';
}

function legacyState(root) {
  return {
    codex: snapshot(path.join(root, '.codex')),
    claude: snapshot(path.join(root, '.claude'))
  };
}

let legacyTemplate;

beforeAll(async () => {
  legacyTemplate = tempRoot();
  const archive = spawnSync(
    'git',
    ['archive', '--format=tar', LEGACY_COMMIT, '.claude/skills'],
    { cwd: ROOT }
  );
  expect(archive.status).toBe(0);
  const extract = spawnSync('tar', ['-xf', '-', '-C', legacyTemplate], { input: archive.stdout });
  expect(extract.status).toBe(0);
  const previous = process.cwd();
  try {
    process.chdir(legacyTemplate);
    const mirrored = await mirrorSkillDirectoriesForPlatform(
      '.claude/skills',
      'codex',
      LEGACY_SKILL_IDS
    );
    expect(mirrored.errors).toEqual([]);
  } finally {
    process.chdir(previous);
  }
  write(
    path.join(legacyTemplate, '.codex/.cc-devflow-managed-skills.json'),
    `${JSON.stringify({ skills: LEGACY_SKILL_IDS }, null, 2)}\n`
  );
});

afterAll(() => {
  fs.rmSync(legacyTemplate, { recursive: true, force: true });
});

function legacyFixture(root) {
  fs.cpSync(path.join(legacyTemplate, '.codex'), path.join(root, '.codex'), { recursive: true });
  fs.cpSync(path.join(legacyTemplate, '.claude'), path.join(root, '.claude'), { recursive: true });
}

describe('Dverity owned-v4 migration', () => {
  test('commits a complete two-host Dverity install with one consistent journal', () => {
    const root = tempRoot();
    legacyFixture(root);
    const preserved = Object.fromEntries(PRESERVED_SKILL_IDS.map((skill) => [
      skill,
      snapshot(path.join(root, '.claude/skills', skill))
    ]));

    const result = run(['migrate', '--project', root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/migrated/i);
    expect(fs.existsSync(path.join(root, '.codex'))).toBe(false);
    expect(fs.readdirSync(path.join(root, '.agents/skills')).sort()).toEqual(DVERITY_SKILL_IDS);
    const claudeSkills = fs.readdirSync(path.join(root, '.claude/skills')).sort();
    expect(DVERITY_SKILL_IDS.every((skill) => claudeSkills.includes(skill))).toBe(true);
    expect(LEGACY_SKILL_IDS.filter((skill) => !DVERITY_SKILL_IDS.includes(skill))
      .some((skill) => claudeSkills.includes(skill))).toBe(false);
    for (const skill of PRESERVED_SKILL_IDS) {
      expect(snapshot(path.join(root, '.claude/skills', skill))).toBe(preserved[skill]);
    }
    const manifest = JSON.parse(fs.readFileSync(
      path.join(root, '.dverity/managed-skills.json'),
      'utf8'
    ));
    const journal = JSON.parse(fs.readFileSync(
      path.join(root, '.dverity/migration-journal.json'),
      'utf8'
    ));
    expect(journal).toMatchObject({ schemaVersion: 1, state: 'committed' });
    expect(journal.completedSteps).toEqual([
      'preflight',
      'stage',
      'verify',
      'data',
      'commit',
      'post-readback',
      'cleanup'
    ]);
    expect(journal.legacy).toMatchObject({
      package: { name: 'cc-devflow', version: '4.5.48' },
      source: { commit: LEGACY_COMMIT }
    });
    expect(journal.transaction.id).toBe(manifest.transaction.id);
    expect(journal.transaction.committedAt).toBe(manifest.transaction.committedAt);
    expect(run(['verify', '--project', root]).status).toBe(0);
  });

  test('schema enumerates before/after injection for every step and mutation edge', () => {
    const expected = MIGRATION_SCHEMA.steps.flatMap((step) => (
      [step.id, ...step.mutationEdges].flatMap((id) => [`before:${id}`, `after:${id}`])
    ));

    expect(MIGRATION_FAULT_POINTS).toEqual(expected);
    expect(new Set(MIGRATION_FAULT_POINTS).size).toBe(MIGRATION_FAULT_POINTS.length);
  });

  test('repeating migrate is a deterministic no-op without timestamp or journal churn', () => {
    const root = tempRoot();
    legacyFixture(root);
    expect(run(['migrate', '--project', root]).status).toBe(0);
    const before = snapshot(root);
    const manifestBefore = fs.readFileSync(path.join(root, '.dverity/managed-skills.json'));
    const journalBefore = fs.readFileSync(path.join(root, '.dverity/migration-journal.json'));

    const repeated = run(['migrate', '--project', root]);

    expect(repeated.status).toBe(0);
    expect(repeated.stdout).toMatch(/already migrated/i);
    expect(snapshot(root)).toBe(before);
    expect(fs.readFileSync(path.join(root, '.dverity/managed-skills.json')))
      .toEqual(manifestBefore);
    expect(fs.readFileSync(path.join(root, '.dverity/migration-journal.json')))
      .toEqual(journalBefore);
  });

  test('moves known evidence with provenance while preserving Unknown and reporting external refs', () => {
    const root = tempRoot();
    legacyFixture(root);
    const postmortem = path.join(root, 'devflow/postmortems/incident.md');
    const research = path.join(root, 'devflow/research/finding.md');
    const changes = path.join(root, 'devflow/changes/REQ-001/task.md');
    const mystery = path.join(root, 'mystery/data.bin');
    const link = path.join(root, 'mystery/latest');
    const workflow = path.join(root, '.github/workflows/legacy.yml');
    write(postmortem, 'historical postmortem\n');
    write(research, 'historical research\n');
    write(changes, 'leave this change in place\n');
    write(mystery, Buffer.from([0, 1, 2, 255]));
    fs.symlinkSync('data.bin', link);
    write(workflow, 'env:\n  CC_DEVFLOW_DOCUMENT_LANGUAGE: zh-CN\n');
    fs.chmodSync(postmortem, 0o640);
    fs.chmodSync(research, 0o600);
    const unknownBefore = {
      changes: snapshot(path.join(root, 'devflow/changes')),
      mystery: snapshot(path.join(root, 'mystery')),
      workflow: snapshot(workflow)
    };
    const reads = [];

    const result = runLifecycle('migrate', resolveScope(['--project', root]), {
      onDataRead: (file) => reads.push(file)
    });

    expect(result.message).toMatch(/Unknown external references/i);
    expect(fs.existsSync(postmortem)).toBe(false);
    expect(fs.existsSync(research)).toBe(false);
    const migratedPostmortem = path.join(root, 'docs/postmortems/incident.md');
    const migratedResearch = path.join(root, 'docs/research/finding.md');
    expect(fs.readFileSync(migratedPostmortem, 'utf8')).toBe('historical postmortem\n');
    expect(fs.readFileSync(migratedResearch, 'utf8')).toBe('historical research\n');
    expect(fs.statSync(migratedPostmortem).mode & 0o7777).toBe(0o640);
    expect(fs.statSync(migratedResearch).mode & 0o7777).toBe(0o600);
    expect(snapshot(path.join(root, 'devflow/changes'))).toBe(unknownBefore.changes);
    expect(snapshot(path.join(root, 'mystery'))).toBe(unknownBefore.mystery);
    expect(snapshot(workflow)).toBe(unknownBefore.workflow);
    expect(reads).toEqual(expect.arrayContaining([
      'devflow/postmortems/incident.md',
      'devflow/research/finding.md',
      '.github/workflows/legacy.yml'
    ]));
    expect(reads.some((file) => file.startsWith('devflow/changes') || file.startsWith('mystery')))
      .toBe(false);
    const journal = JSON.parse(fs.readFileSync(
      path.join(root, '.dverity/migration-journal.json'),
      'utf8'
    ));
    expect(journal.dataMigration).toMatchObject({ fullyClean: false });
    expect(journal.dataMigration.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'devflow/postmortems/incident.md',
        destination: 'docs/postmortems/incident.md',
        type: 'file',
        mode: 0o640
      }),
      expect.objectContaining({
        source: 'devflow/research/finding.md',
        destination: 'docs/research/finding.md',
        type: 'file',
        mode: 0o600
      })
    ]));
    expect(journal.dataMigration.externalReferences).toEqual([
      {
        path: '.github/workflows/legacy.yml',
        evidenceGap: 'manifest-external legacy reference',
        nextOwner: 'root operator'
      }
    ]);
  });

  test.each(DATA_FAULT_POINTS)('%s restores known evidence and every Unknown path', (point) => {
    const root = tempRoot();
    legacyFixture(root);
    write(path.join(root, 'devflow/postmortems/incident.md'), 'historical postmortem\n');
    write(path.join(root, 'devflow/research/finding.md'), 'historical research\n');
    write(path.join(root, 'devflow/changes/REQ-001/task.md'), 'unknown change\n');
    write(path.join(root, 'mystery/data.bin'), Buffer.from([0, 1, 2, 255]));
    const before = {
      postmortems: snapshot(path.join(root, 'devflow/postmortems')),
      research: snapshot(path.join(root, 'devflow/research')),
      changes: snapshot(path.join(root, 'devflow/changes')),
      mystery: snapshot(path.join(root, 'mystery'))
    };

    expect(() => runLifecycle('migrate', resolveScope(['--project', root]), {
      fault: (current) => {
        if (current === point) throw new Error(`injected data fault at ${point}`);
      }
    })).toThrow(/injected data fault/);

    expect(snapshot(path.join(root, 'devflow/postmortems'))).toBe(before.postmortems);
    expect(snapshot(path.join(root, 'devflow/research'))).toBe(before.research);
    expect(snapshot(path.join(root, 'devflow/changes'))).toBe(before.changes);
    expect(snapshot(path.join(root, 'mystery'))).toBe(before.mystery);
    expect(fs.existsSync(path.join(root, 'docs/postmortems'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'docs/research'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.dverity/transactions'))).toBe(false);
  });

  test('Unknown cannot be converted into a skipped journal field', () => {
    const root = tempRoot();
    legacyFixture(root);
    write(
      path.join(root, '.github/workflows/legacy.yml'),
      'env:\n  CC_DEVFLOW_DOCUMENT_LANGUAGE: zh-CN\n'
    );
    expect(run(['migrate', '--project', root]).status).toBe(0);
    const journalFile = path.join(root, '.dverity/migration-journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    journal.dataMigration.skipped = true;
    fs.writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    const before = snapshot(root);

    const repeated = run(['migrate', '--project', root]);

    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toMatch(/durable-data evidence/i);
    expect(snapshot(root)).toBe(before);
  });

  test('journal provenance cannot omit a migrated destination', () => {
    const root = tempRoot();
    legacyFixture(root);
    write(path.join(root, 'devflow/postmortems/incident.md'), 'historical postmortem\n');
    expect(run(['migrate', '--project', root]).status).toBe(0);
    const journalFile = path.join(root, '.dverity/migration-journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    journal.dataMigration.provenance = [];
    fs.writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    const before = snapshot(root);

    const repeated = run(['migrate', '--project', root]);

    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toMatch(/does not match provenance/i);
    expect(snapshot(root)).toBe(before);
  });

  test('ancestor symlink cannot move known evidence outside the selected root', () => {
    const root = tempRoot();
    const outside = tempRoot();
    legacyFixture(root);
    write(path.join(outside, 'postmortems/incident.md'), 'external evidence\n');
    fs.symlinkSync(outside, path.join(root, 'devflow'), 'dir');
    const rootBefore = snapshot(root);
    const outsideBefore = snapshot(outside);

    const result = run(['migrate', '--project', root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/symlink/i);
    expect(snapshot(root)).toBe(rootBefore);
    expect(snapshot(outside)).toBe(outsideBefore);
    expect(fs.existsSync(path.join(root, '.dverity'))).toBe(false);
  });

  test('mixed legacy residue blocks no-op without changing the root', () => {
    const root = tempRoot();
    legacyFixture(root);
    expect(run(['migrate', '--project', root]).status).toBe(0);
    write(path.join(root, '.codex/.cc-devflow-managed-skills.json'), '{"skills":[]}\n');
    const before = snapshot(root);

    const repeated = run(['migrate', '--project', root]);

    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toMatch(/mixed legacy/i);
    expect(snapshot(root)).toBe(before);
  });

  test('truncated committed journal blocks no-op without changing the root', () => {
    const root = tempRoot();
    legacyFixture(root);
    expect(run(['migrate', '--project', root]).status).toBe(0);
    const journalFile = path.join(root, '.dverity/migration-journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    journal.completedEdges = journal.completedEdges.slice(1);
    fs.writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    const before = snapshot(root);

    const repeated = run(['migrate', '--project', root]);

    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toMatch(/journal.*committed transaction evidence/i);
    expect(snapshot(root)).toBe(before);
  });

  test.each([
    ['stale', (root) => {
      fs.writeFileSync(path.join(root, '.codex/skills/cc-act/SKILL.md'), 'drift\n');
    }],
    ['partial', (root) => {
      const file = path.join(root, '.codex/.cc-devflow-managed-skills.json');
      const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
      marker.skills = marker.skills.slice(1);
      fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`);
    }],
    ['partial projection', (root) => {
      fs.rmSync(path.join(root, '.claude/skills'), { recursive: true });
    }],
    ['forged', (root) => {
      const file = path.join(root, '.codex/.cc-devflow-managed-skills.json');
      const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
      marker.provenance = { commit: '0'.repeat(40) };
      fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`);
    }]
  ])('%s marker remains unchanged and gains no ownership claim', (_name, mutate) => {
    const root = tempRoot();
    legacyFixture(root);
    mutate(root);
    const before = snapshot(root);

    const result = run(['migrate', '--project', root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unknown legacy ownership/i);
    expect(snapshot(root)).toBe(before);
    expect(fs.existsSync(path.join(root, '.dverity'))).toBe(false);
  });

  test('compensation cleanup error is reported after retry restores full old state', () => {
    const root = tempRoot();
    legacyFixture(root);
    const original = legacyState(root);
    const fault = (point) => {
      if (point === 'after:publish-manifest') throw new Error('commit fault');
    };
    const compensationFault = (edge) => {
      if (edge === 'retire-claude') throw new Error('cleanup fault');
    };

    expect(() => runLifecycle(
      'migrate',
      resolveScope(['--project', root]),
      { compensationFault, fault }
    )).toThrow(/compensation failed.*cleanup fault/i);
    expect(migrationState(root, original)).toBe('old');
    const journal = JSON.parse(fs.readFileSync(
      path.join(root, '.dverity/migration-journal.json'),
      'utf8'
    ));
    expect(journal).toMatchObject({ state: 'rolled-back' });
    expect(journal.cleanupErrors).toContain('retire-claude: cleanup fault');
  });

  test.each(MIGRATION_FAULT_POINTS)('%s terminates as full old or full Dverity', (point) => {
    const root = tempRoot();
    legacyFixture(root);
    const original = legacyState(root);
    const fault = jest.fn((current) => {
      if (current === point) throw new Error(`injected fault at ${point}`);
    });

    expect(() => runLifecycle(
      'migrate',
      resolveScope(['--project', root]),
      { fault }
    )).toThrow(/injected fault/);
    expect(fault).toHaveBeenCalledWith(point);
    expect(['old', 'dverity']).toContain(migrationState(root, original));

    const journalFile = path.join(root, '.dverity/migration-journal.json');
    if (fs.existsSync(journalFile)) {
      const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
      const compensable = new Set([
        'stage-projections',
        'stage-unknown',
        'stage-manifest',
        'retire-codex',
        'retire-claude',
        'publish-agents',
        'publish-claude',
        'publish-manifest'
      ]);
      const expectedCompensations = [...journal.completedEdges]
        .filter((edge) => compensable.has(edge))
        .reverse();
      expect(journal.compensations).toEqual(
        journal.state === 'rolled-back' ? expectedCompensations : []
      );
      expect(['rolled-back', 'committed']).toContain(journal.state);
      if (point === 'before:transaction-cleanup') {
        expect(journal).toMatchObject({
          state: 'committed',
          cleanupError: 'injected fault at before:transaction-cleanup'
        });
      }
    }
  });
});
