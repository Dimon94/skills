const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = '.claude/skills/postmortem/SKILL.md';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readSkill(relativePath) {
  return matter(read(relativePath));
}

describe('postmortem skill contract', () => {
  test('defines a model-invoked standalone and workflow failure-memory skill', () => {
    const skill = readSkill(SKILL_PATH);
    const body = skill.content;

    expect(skill.data.name).toBe('postmortem');
    expect(skill.data.version).toBe('1.0.0');
    expect(skill.data.description).toMatch(/Postmortem failure-memory skill/);
    expect(skill.data.description).toMatch(/recall, interrogate, record, or update/);
    expect(skill.data.triggers).toEqual(expect.arrayContaining(['写尸检', 'recall postmortems']));
    expect(skill.data.reads).toEqual(expect.arrayContaining([
      'PLAYBOOK.md',
      'assets/POSTMORTEM_TEMPLATE.md',
      'assets/POSTMORTEM_INDEX_TEMPLATE.md'
    ]));

    for (const required of [
      /recall/,
      /interrogate/,
      /record/,
      /recurring-pattern/,
      /special-case/,
      /recurrence_key/,
      /task\.md#Failure Ledger/,
      /devflow\/postmortems/
    ]) {
      expect(body).toMatch(required);
    }
  });

  test('templates stay compact and searchable', () => {
    const template = read('.claude/skills/postmortem/assets/POSTMORTEM_TEMPLATE.md');
    const index = read('.claude/skills/postmortem/assets/POSTMORTEM_INDEX_TEMPLATE.md');

    for (const required of [
      /source: manual \| cc-act/,
      /lesson_type: recurring-pattern \| special-case/,
      /recall_weight: high \| medium \| low/,
      /root_cause_status: confirmed \| suspected \| unknown/,
      /recurrence_key:/,
      /recall_only_when:/,
      /## 事实摘要/,
      /## 复发判断/,
      /## 根因与逃逸点/,
      /## 后续处理警告/,
      /## 证据/,
      /## 工作流修补候选/
    ]) {
      expect(template).toMatch(required);
    }

    expect(index).toContain('| recurrence_key | count | last_seen | lesson_type | recall_weight | tags | one_line_lesson | incident_path |');
  });

  test('workflow skills reference the shared postmortem contract', () => {
    for (const skillName of ['cc-plan', 'cc-diagnose', 'cc-review', 'cc-check', 'cc-act']) {
      const skill = readSkill(`.claude/skills/${skillName}/SKILL.md`);
      expect(skill.data.reads).toContain('../postmortem/SKILL.md');
    }
  });

  test('legacy postmortem remains registered but is not a package inventory owner', () => {
    const config = JSON.parse(read('config/distributable-skills.json'));
    const pkg = JSON.parse(read('package.json'));

    expect(config.publicSkills).toContain('postmortem');
    expect(config.distributedSkills).toContain('postmortem');
    expect(pkg.files).not.toContain('.claude/skills/postmortem/');
    expect(pkg.files).toContain('skills/');
  });
});
