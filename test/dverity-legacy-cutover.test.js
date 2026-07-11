const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  classifyLegacySurface,
  legacyRuntimeViolations
} = require('../lib/dverity/legacy/classifier');

const LEGACY_PREFIX = ['c', 'c', '-'].join('');
const ROOT = path.resolve(__dirname, '..');

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('classifies active Skill IDs separately from immutable history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-legacy-'));
  const skillId = `${LEGACY_PREFIX}old`;
  write(root, `skills/${skillId}/SKILL.md`, `---\nname: ${skillId}\n---\n`);
  write(root, 'CHANGELOG.md', `Removed ${skillId}.\n`);

  expect(classifyLegacySurface({ root })).toEqual([
    expect.objectContaining({ path: 'CHANGELOG.md', type: 'history-only' }),
    expect.objectContaining({ path: `skills/${skillId}/SKILL.md`, type: 'runtime-id' })
  ]);
});

test('allows only schema-tagged migration input in current documentation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-migration-'));
  const skillId = `${LEGACY_PREFIX}old`;
  write(root, 'docs/migration-v5.md', `\`\`\`legacy-input\n${skillId}\n\`\`\`\n`);
  write(root, 'README.md', `Run ${skillId}.\n`);

  expect(classifyLegacySurface({ root })).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'docs/migration-v5.md', type: 'migration-input' }),
    expect.objectContaining({ path: 'README.md', type: 'current-doc' })
  ]));
});

test('types command, route, host, broad-history, and duplicate-state-machine residue', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-negative-'));
  const skillId = `${LEGACY_PREFIX}old`;
  const legacyCli = ['c', 'c', '-', 'devflow'].join('');
  write(root, `bin/${legacyCli}-cli.js`, `handlers.init = () => 0;\n`);
  write(root, 'scripts/allowlisted.js', `require('../skills/${skillId}');\n`);
  write(root, 'config/adapters.yml', 'platforms:\n  - cursor\n');
  write(root, 'docs/history/current.md', `Run ${skillId}.\n`);
  write(root, 'skills/current/SKILL.md', [
    '```mermaid',
    'flowchart TD',
    'A["Debug"]',
    'B["Inspect"]',
    'C["Ship"]',
    'A --> B',
    'B --> C',
    '```'
  ].join('\n'));

  expect(classifyLegacySurface({ root })).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: `bin/${legacyCli}-cli.js`, type: 'command-handler' }),
    expect.objectContaining({ path: 'scripts/allowlisted.js', type: 'reachable-route' }),
    expect.objectContaining({ path: 'config/adapters.yml', type: 'current-output' }),
    expect.objectContaining({ path: 'docs/history/current.md', type: 'current-doc' }),
    expect.objectContaining({ path: 'skills/current/SKILL.md', type: 'duplicate-state-machine' })
  ]));
});

test('fails closed on hidden routes, active history reads, removed IDs, and package handlers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-fail-closed-'));
  const skillId = `${LEGACY_PREFIX}old`;
  const legacyCli = ['c', 'c', '-', 'devflow'].join('');
  write(root, 'scripts/dynamic-route.js', [
    `const id = '${skillId}';`,
    "require('../skills/' + id);"
  ].join('\n'));
  write(root, 'scripts/history-reader.js', "fs.readFileSync('CHANGELOG.md');\n");
  write(root, 'skills/current/SKILL.md', [
    '---',
    'name: current',
    'reads: [../quality-gate-contract/SKILL.md]',
    'triggers: [diagnosing-bugs]',
    '---'
  ].join('\n'));
  write(root, 'skills/history-reader/SKILL.md', [
    '---',
    'name: history-reader',
    'metadata:',
    '  reads: [../../devflow/changes/REQ-old/task.md]',
    '---'
  ].join('\n'));
  write(root, 'package.json', JSON.stringify({
    bin: { [legacyCli]: `bin/${legacyCli}.js` },
    files: ['skills/'],
    scripts: {}
  }));
  write(root, 'active.txt', `candidate=${skillId}\n`);

  expect(classifyLegacySurface({ root })).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'scripts/dynamic-route.js', type: 'unclassified' }),
    expect.objectContaining({ path: 'scripts/history-reader.js', type: 'reachable-route' }),
    expect.objectContaining({ path: 'skills/current/SKILL.md', type: 'runtime-id' }),
    expect.objectContaining({ path: 'skills/history-reader/SKILL.md', type: 'reachable-route' }),
    expect.objectContaining({ path: 'package.json', type: 'command-handler' }),
    expect.objectContaining({ path: 'active.txt', type: 'unclassified' })
  ]));
});

test('has zero active legacy runtime reachability in the repository', () => {
  expect(legacyRuntimeViolations(classifyLegacySurface({ root: ROOT }))).toEqual([]);
});

test('requires schema tags around one-time migrator input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-runtime-input-'));
  const legacyCli = ['c', 'c', '-', 'devflow'].join('');
  write(root, 'lib/dverity/lifecycle.js', [
    '// dverity:legacy-input:start',
    `const migrationSource = '${legacyCli}';`,
    '// dverity:legacy-input:end',
    `const runtimeAlias = '${legacyCli}';`
  ].join('\n'));

  expect(classifyLegacySurface({ root })).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'lib/dverity/lifecycle.js', type: 'migration-input' }),
    expect.objectContaining({ path: 'lib/dverity/lifecycle.js', type: 'reachable-route' })
  ]));
});
