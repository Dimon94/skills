const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const { enumerateSkillSource } = require('../lib/dverity/install/skill-source');
const {
  decidePostmortem,
  recordPostmortem
} = require('../skills/postmortem/scripts/postmortem-contract');

const ROOT = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('postmortem is one reachable reusable dependency in the exact-nine source', () => {
  const source = enumerateSkillSource({ root: ROOT });
  const skill = matter(read('skills/postmortem/SKILL.md'));

  expect(source.skills.find(({ id }) => id === 'postmortem')).toMatchObject({
    class: 'reusable-dependency',
    path: 'skills/postmortem'
  });
  expect(skill.data).toMatchObject({
    name: 'postmortem',
    metadata: {
      dverity_class: 'reusable-dependency',
      resources: ['scripts/postmortem-contract.js']
    }
  });
});

test('Repair consumes postmortem without creating another workflow owner', () => {
  expect(read('skills/dverity-repair/SKILL.md')).toContain('../postmortem/SKILL.md');
  expect(read('skills/postmortem/SKILL.md')).toContain('does not own workflow state');
  expect(decidePostmortem({ trigger: 'ordinary-failure', confirmed: true })).toEqual({
    recall: false,
    record: false,
    status: 'ready'
  });
  expect(typeof recordPostmortem).toBe('function');
});
