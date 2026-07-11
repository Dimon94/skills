const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = '.claude/skills/task-contract/SKILL.md';
const CORE_READERS = ['cc-dev', 'cc-plan', 'cc-do', 'cc-check', 'cc-review', 'cc-act'];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readSkill(relativePath) {
  return matter(readText(relativePath));
}

describe('task-contract Chain Skill contract', () => {
  test('source skill defines task.md semantics without becoming a user entry skill', () => {
    const skill = readSkill(SKILL_PATH);
    const body = skill.content;

    expect(skill.data.name).toBe('task-contract');
    expect(skill.data.description).toMatch(/Chain Skill/i);
    expect(skill.data).not.toHaveProperty('triggers');
    expect(skill.data.reads).toEqual([]);

    for (const required of [
      /task\.md/,
      /Status/,
      /Task Blocks/,
      /Failure Ledger/,
      /Execution Environments/,
      /Readers And Writers/,
      /not a parser input language, DSL, CLI surface, workflow router, or\s+delivery policy/i
    ]) {
      expect(body).toMatch(required);
    }
  });

  test('core PDCA skills read the shared task contract', () => {
    for (const skillName of CORE_READERS) {
      const skill = readSkill(`.claude/skills/${skillName}/SKILL.md`);

      expect(skill.data.reads).toContain('../task-contract/SKILL.md');
    }
  });

  test('legacy task contract remains non-public and is absent from the Dverity package', () => {
    const config = require('../config/distributable-skills.json');
    const pkg = require('../package.json');

    expect(config.distributedSkills).toContain('task-contract');
    expect(config.publicSkills).not.toContain('task-contract');
    expect(pkg.files).not.toContain('.claude/skills/task-contract/');
    expect(pkg.files).toContain('skills/');
  });
});
