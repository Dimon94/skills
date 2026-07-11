const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildSkillProvenance,
  enumerateSkillSource,
  validateSkillProvenance
} = require('../../install/skill-source');

const ROOT = path.resolve(__dirname, '../../../..');

function sourceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-source-'));
  fs.cpSync(path.join(ROOT, 'skills'), path.join(root, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib/dverity/review'), { recursive: true });
  for (const file of ['git-source.js', 'review-item-record.js', 'submit.js']) {
    fs.copyFileSync(
      path.join(ROOT, 'lib/dverity/review', file),
      path.join(root, 'lib/dverity/review', file)
    );
  }
  fs.copyFileSync(path.join(ROOT, 'DVERITY.md'), path.join(root, 'DVERITY.md'));
  return root;
}

function replaceReads(root, value) {
  const skill = path.join(root, 'skills/postmortem/SKILL.md');
  const content = fs.readFileSync(skill, 'utf8');
  fs.writeFileSync(skill, content.replace('reads: []', `reads:\n  - ${value}`));
}

describe('Dverity root Skill source', () => {
  test('enumerates the approved exact nine Skills and their 3/6 classification', () => {
    const source = enumerateSkillSource({ root: ROOT });

    expect(source.skills.map((skill) => skill.id)).toEqual([
      'do-not-repeat-yourself',
      'dverity-repair',
      'dverity-research',
      'dverity-simplify',
      'git-commit',
      'merge-remote-review',
      'postmortem',
      'resolving-merge-conflicts',
      'submit-remote-review'
    ]);
    expect(source.skills.filter((skill) => skill.class === 'workflow-entry'))
      .toHaveLength(3);
    expect(source.skills.filter((skill) => skill.class === 'reusable-dependency'))
      .toHaveLength(6);
    expect(source.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(source.enumeration_run).toBe(`skills:${source.source_hash}`);
  });

  test('drives package, registry, installer, and both projection plans from one enumeration', () => {
    const enumerate = jest.fn(enumerateSkillSource);
    const graph = buildSkillProvenance({ root: ROOT, enumerate });
    const consumers = [
      graph.package,
      graph.registry,
      graph.installer,
      graph.projections.agents,
      graph.projections.claude
    ];

    expect(enumerate).toHaveBeenCalledTimes(1);
    expect(graph.package.identity).toEqual({ name: 'dverity', version: '5.0.0' });
    for (const consumer of consumers) {
      expect(consumer.enumeration_run).toBe(graph.source.enumeration_run);
      expect(consumer.source_hash).toBe(graph.source.source_hash);
      expect(consumer.skills).toEqual(graph.source.skills);
    }
    expect(graph.projections.agents.root).toBe('.agents/skills');
    expect(graph.projections.claude.root).toBe('.claude/skills');
    expect(graph.registry.entries).toEqual(graph.source.skills.map((skill) => ({
      id: skill.id,
      class: skill.class,
      path: skill.path,
      hash: skill.hash
    })));
    expect(graph.package.files).toEqual(graph.source.skills.flatMap((skill) => (
      skill.files.map((file) => `${skill.path}/${file}`)
    )));
    expect(graph.projections.agents.entries[0]).toEqual({
      id: graph.source.skills[0].id,
      source: graph.source.skills[0].path,
      target: `.agents/skills/${graph.source.skills[0].id}`,
      hash: graph.source.skills[0].hash
    });
    expect(graph.installer.projections).toEqual([
      { root: '.agents/skills', enumeration_run: graph.source.enumeration_run },
      { root: '.claude/skills', enumeration_run: graph.source.enumeration_run }
    ]);
  });

  test('rejects secondary enumeration and same-name source drift in consumer plans', () => {
    const graph = buildSkillProvenance({ root: ROOT });
    const secondary = structuredClone(graph);
    secondary.registry.enumeration_run = 'skills:secondary';
    const drifted = structuredClone(graph);
    drifted.projections.agents.skills = structuredClone(graph.source.skills);
    drifted.projections.agents.skills[0].hash = '0'.repeat(64);

    expect(validateSkillProvenance(graph)).toEqual({ success: true });
    expect(validateSkillProvenance(secondary)).toEqual({
      success: false,
      error: 'registry has secondary enumeration provenance'
    });
    expect(validateSkillProvenance(drifted)).toEqual({
      success: false,
      error: '.agents/skills has same-name source drift'
    });
  });

  test('rejects drift in a derived projection plan', () => {
    const graph = buildSkillProvenance({ root: ROOT });
    graph.projections.claude.entries[0].target = '.agents/skills/wrong-target';

    expect(validateSkillProvenance(graph)).toEqual({
      success: false,
      error: '.claude/skills projection plan drift'
    });
  });

  test('rejects a non-canonical package identity', () => {
    const graph = buildSkillProvenance({ root: ROOT });
    graph.package.identity = { name: 'cc-devflow', version: '5.0.0' };

    expect(validateSkillProvenance(graph)).toEqual({
      success: false,
      error: 'package identity must be dverity@5.0.0'
    });
  });

  test.each([
    ['missing Skill', (root) => fs.rmSync(path.join(root, 'skills/postmortem'), { recursive: true })],
    ['extra Skill', (root) => {
      const file = path.join(root, 'skills/tenth-skill/SKILL.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, [
        '---',
        'name: tenth-skill',
        'metadata:',
        '  dverity_class: reusable-dependency',
        '---',
        ''
      ].join('\n'));
    }],
    ['misclassified Skill', (root) => {
      const file = path.join(root, 'skills/postmortem/SKILL.md');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
        .replace('reusable-dependency', 'workflow-entry'));
    }],
    ['same directory with a different source name', (root) => {
      const file = path.join(root, 'skills/postmortem/SKILL.md');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
        .replace('name: postmortem', 'name: different-source'));
    }]
  ])('rejects a %s fixture', (_name, mutate) => {
    const root = sourceFixture();
    mutate(root);

    expect(() => enumerateSkillSource({ root })).toThrow(
      /exactly 9|invalid Skill|unexpected Skill|name\/source mismatch/i
    );
  });

  test.each([
    [
      'absolute personal path',
      '/Users/example/private/SKILL.md',
      /escapes package root|personal or plugin path/i
    ],
    ['package escape', '../../../outside.md', /escapes package root/i],
    ['unresolved read', 'references/missing.md', /unresolved dependency/i]
  ])('rejects %s dependencies', (_name, dependency, message) => {
    const root = sourceFixture();
    replaceReads(root, dependency);

    expect(() => enumerateSkillSource({ root })).toThrow(message);
  });

  test('rejects history-only files as active Skill dependencies', () => {
    const root = sourceFixture();
    const history = path.join(root, 'devflow/changes/REQ-old/task.md');
    fs.mkdirSync(path.dirname(history), { recursive: true });
    fs.writeFileSync(history, 'historical task\n');
    replaceReads(root, '../../devflow/changes/REQ-old/task.md');

    expect(() => enumerateSkillSource({ root })).toThrow(/history-only file/i);
  });

  test('rejects unresolved relative imports in bundled Skill scripts', () => {
    const root = sourceFixture();
    const script = path.join(root, 'skills/postmortem/scripts/run.js');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "require('./missing');\n");

    expect(() => enumerateSkillSource({ root })).toThrow(/unresolved import/i);
  });

  test('rejects unresolved side-effect imports in bundled Skill scripts', () => {
    const root = sourceFixture();
    const script = path.join(root, 'skills/postmortem/scripts/run.mjs');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "import './missing.js';\n");

    expect(() => enumerateSkillSource({ root })).toThrow(/unresolved import/i);
  });

  test('rejects hidden personal or plugin paths in bundled source content', () => {
    const root = sourceFixture();
    const skill = path.join(root, 'skills/postmortem/SKILL.md');
    fs.appendFileSync(skill, '\nLoad /Users/example/.codex/plugins/cache/tool/SKILL.md\n');

    expect(() => enumerateSkillSource({ root })).toThrow(/personal or plugin path/i);
  });
});
