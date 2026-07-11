const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = '.claude/skills/cc-research/SKILL.md';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readSkill(relativePath) {
  return matter(read(relativePath));
}

describe('cc-research skill contract', () => {
  test('defines a public capability skill for project-grounded research', () => {
    const skill = readSkill(SKILL_PATH);
    const body = skill.content;

    expect(skill.data.name).toBe('cc-research');
    expect(skill.data.version).toBe('1.0.0');
    expect(skill.data.description).toMatch(/project-grounded research capability skill/i);
    expect(skill.data.description).toMatch(/sidecar/);
    expect(skill.data.triggers).toEqual(expect.arrayContaining([
      '/research',
      '项目调研',
      'cc-research'
    ]));
    expect(skill.data.reads).toEqual(expect.arrayContaining([
      'PLAYBOOK.md',
      'assets/RESEARCH_TEMPLATE.md',
      'assets/RESEARCH_INDEX_TEMPLATE.jsonl'
    ]));
    expect(skill.data.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'devflow/research/index.jsonl' }),
      expect.objectContaining({ path: 'devflow/research/entries/<date>-<slug>.md' })
    ]));

    for (const required of [
      /Local Grounding Gate/,
      /Project Evidence First/,
      /Prior Research Freshness Check/,
      /Evidence Grade/,
      /Context Return/,
      /devflow\/research/,
      /not an implementation plan/,
      /not a task breakdown/
    ]) {
      expect(body).toMatch(required);
    }
  });

  test('research templates are Chinese, source-first, and index-only metadata', () => {
    const template = read('.claude/skills/cc-research/assets/RESEARCH_TEMPLATE.md');
    const indexTemplate = read('.claude/skills/cc-research/assets/RESEARCH_INDEX_TEMPLATE.jsonl');

    for (const required of [
      /## 参考材料/,
      /## 当前目标/,
      /## 项目现状快照/,
      /## 研究问题/,
      /## 证据与分析/,
      /## 推荐结论/,
      /证据等级: 高 \| 中 \| 低/,
      /## 风险与未知/,
      /## 对当前项目的影响/
    ]) {
      expect(template).toMatch(required);
    }

    const indexEntry = JSON.parse(indexTemplate.trim());
    expect(indexEntry).toEqual(expect.objectContaining({
      date: '',
      file: '',
      title: '',
      status: 'done',
      summary_zh: '',
      use_when: '',
      evidence_grade: ''
    }));
    expect(indexEntry).not.toHaveProperty('recommendation');
    expect(indexEntry).not.toHaveProperty('body');
  });

  test('workflow skills consult research only at evidence-gap seams', () => {
    for (const skillName of ['cc-plan', 'cc-diagnose', 'cc-review']) {
      const skill = readSkill(`.claude/skills/${skillName}/SKILL.md`);
      expect(skill.data.reads).toContain('../cc-research/SKILL.md');
    }

    for (const skillName of ['cc-check', 'cc-act']) {
      const skill = readSkill(`.claude/skills/${skillName}/SKILL.md`);
      expect(skill.data.reads).not.toContain('../cc-research/SKILL.md');
    }
  });

  test('legacy research source remains registered but is not a package inventory owner', () => {
    const artifactContract = read('docs/guides/artifact-contract.md');
    const minimizeArtifacts = read('docs/guides/minimize-artifacts.md');
    const context = read('CONTEXT.md');
    const config = JSON.parse(read('config/distributable-skills.json'));
    const pkg = JSON.parse(read('package.json'));

    expect(artifactContract).toContain('devflow/research/index.jsonl');
    expect(artifactContract).toContain('devflow/research/entries/<date>-<slug>.md');
    expect(minimizeArtifacts).toContain('cc-research');
    expect(context).toContain('Capability Skill');
    expect(context).toContain('devflow/research/');
    expect(config.publicSkills).toContain('cc-research');
    expect(config.distributedSkills).toContain('cc-research');
    expect(pkg.files).not.toContain('.claude/skills/cc-research/');
    expect(pkg.files).toContain('skills/');
  });
});
