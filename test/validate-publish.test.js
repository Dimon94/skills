const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_CLI = ['c', 'c', '-', 'devflow'].join('');

test('publish validation passes the Dverity-only source gate', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-publish.js'], {
    cwd: ROOT,
    encoding: 'utf8'
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('validate-publish: ok');
});

test('old executables, modules, projections, and control-plane tests are absent', () => {
  const removed = [
    `bin/${LEGACY_CLI}.js`,
    `bin/${LEGACY_CLI}-cli.js`,
    'bin/adapt.js',
    'lib/adapters',
    'lib/compiler',
    'lib/skill-runtime',
    '.claude',
    'tests'
  ];

  expect(removed.filter((entry) => fs.existsSync(path.join(ROOT, entry)))).toEqual([]);
});

test.each(['init', 'adapt', 'config', 'next-change-key', '--platform'])(
  'removed command %s is unknown without a warning stub',
  (command) => {
    const result = spawnSync(process.execPath, ['bin/dverity-cli.js', command], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toBe(`Unknown command: ${command}\n`);
  }
);
