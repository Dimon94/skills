const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  validateManagedResourceCopies,
  validateCommitGuidelineRefs
} = require('../scripts/validate-publish');

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('validate-publish', () => {
  test('publish validation passes', () => {
    const result = spawnSync(process.execPath, ['scripts/validate-publish.js'], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('validate-publish: ok');
  });

  test('package scripts no longer expose retired artifact validators', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    expect(pkg.scripts).toEqual({
      prepack: 'node scripts/dverity-provenance.js prepare',
      postpack: 'node scripts/dverity-provenance.js clean',
      prepublishOnly: 'node scripts/validate-publish.js',
      test: 'jest',
      verify: 'npm test -- --runInBand && npm run verify:publish',
      'verify:publish': 'node scripts/validate-publish.js'
    });
  });

  test('package ships the Dverity lifecycle from the root Skill source', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    expect(pkg.bin).toEqual({ dverity: 'bin/dverity.js' });
    expect(pkg.scripts).toMatchObject({
      prepack: 'node scripts/dverity-provenance.js prepare',
      postpack: 'node scripts/dverity-provenance.js clean'
    });
    expect(pkg.files).toEqual([
      'DVERITY.md',
      'bin/dverity.js',
      'bin/dverity-cli.js',
      'lib/dverity/git-source.js',
      'lib/dverity/lifecycle.js',
      'lib/dverity/package-provenance.json',
      'lib/dverity/review-item-record.js',
      'lib/dverity/skill-source.js',
      'lib/dverity/submit.js',
      'skills/'
    ]);
    expect(pkg.files.some((entry) => entry.startsWith('.claude/'))).toBe(false);
    expect(pkg.files.some((entry) => entry.includes('cc-devflow'))).toBe(false);
  });

  test('retired task-contract artifacts remain banned', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts/validate-publish.js'), 'utf8');

    expect(script).toContain('/task-contract|review-records|benchmark-artifacts|verify-artifacts/');
    expect(script).toContain("['task-contract', ' review ', 'compile ', 'validate ']");
  });

  test('publish validation includes skill suite graph validation', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts/validate-publish.js'), 'utf8');

    expect(script).toContain('validateSkillSuiteGraph');
  });

  test('CLI no longer exposes runtime queries', () => {
    const result = spawnSync(process.execPath, ['bin/cc-devflow-cli.js', '--help'], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('query ');
  });

  test('retired query command fails closed instead of using adapter fallback', () => {
    const result = spawnSync(process.execPath, ['bin/cc-devflow-cli.js', 'query', 'list'], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('cc-devflow query has been removed');
    expect(result.stderr).not.toContain('Codex executed');
  });

  test('top-level options fail closed instead of using adapter fallback', () => {
    const result = spawnSync(process.execPath, ['bin/cc-devflow-cli.js', '--cwd', ROOT], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('Unknown top-level option: --cwd');
    expect(result.stderr).not.toContain('Codex executed');
  });

  test('skill contracts do not tell agents to switch or push main directly', () => {
    const forbidden = [
      /\bgit\s+(checkout|switch)\s+main\b/,
      /\bgit\s+push\s+origin\s+main\b/,
      /On branch main/,
      /Not on main branch/
    ];
    const skillRoot = path.join(ROOT, '.claude', 'skills');

    function walk(target) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        return fs.readdirSync(target).flatMap((entry) => walk(path.join(target, entry)));
      }
      return /\.(md|sh)$/.test(target) ? [target] : [];
    }

    const offenders = walk(skillRoot).flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return forbidden
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path.relative(ROOT, file)} matched ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });

  test('managed resource copies fail when strict copies drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-resource-drift-'));
    writeFile(path.join(root, 'owner.md'), 'same');
    writeFile(path.join(root, 'copy.md'), 'different');

    const errors = [];
    validateManagedResourceCopies(errors, {
      root,
      manifest: {
        managedResourceCopies: [{
          name: 'sample',
          owner: 'owner.md',
          copies: ['copy.md'],
          policy: 'must-match'
        }]
      }
    });

    expect(errors).toContain('Managed Resource Copy sample drift: copy.md must match owner.md');
  });

  test('managed resource copy variants need a reason', () => {
    const errors = [];
    validateManagedResourceCopies(errors, {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'managed-resource-variant-')),
      manifest: {
        managedResourceCopies: [{
          name: 'variant',
          owner: 'owner.md',
          copies: ['copy.md'],
          policy: 'variant'
        }]
      }
    });

    expect(errors).toContain('Managed Resource Copy variant uses policy variant but is missing variantReason');
  });

  test('managed resource copy manifest shape fails closed', () => {
    const errors = [];
    validateManagedResourceCopies(errors, {
      manifest: {}
    });

    expect(errors).toContain('config/managed-resource-copies.json managedResourceCopies must be an array');
  });

  test('publish validation reports missing managed resource owner without crashing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-resource-missing-owner-'));
    const errors = [];
    const manifest = {
      managedResourceCopies: [{
        name: 'git-commit-guidelines',
        copies: ['copy.md'],
        policy: 'must-match'
      }]
    };

    validateManagedResourceCopies(errors, { root, manifest });
    expect(() => validateCommitGuidelineRefs(errors, { root, manifest })).not.toThrow();

    expect(errors).toContain('Managed Resource Copy git-commit-guidelines missing owner');
  });
});
