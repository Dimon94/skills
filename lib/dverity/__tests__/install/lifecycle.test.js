const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const matter = require('gray-matter');

const ROOT = path.resolve(__dirname, '../../../..');
const CLI = path.join(ROOT, 'bin', 'dverity-cli.js');

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    ...options
  });
}

function tempRoot(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
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

const SKILL_IDS = [
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

describe('Dverity lifecycle CLI', () => {
  test('exposes only the four lifecycle commands plus help and version', () => {
    const help = run(['--help']);

    expect(help.status).toBe(0);
    expect(help.stdout).toContain('install');
    expect(help.stdout).toContain('migrate');
    expect(help.stdout).toContain('verify');
    expect(help.stdout).toContain('uninstall');
    for (const removed of ['init', 'adapt', 'config', 'next-change-key', 'platform']) {
      expect(help.stdout).not.toContain(removed);
      expect(run([removed]).status).toBe(3);
    }
    expect(run(['--version']).stdout.trim()).toBe('5.0.0');
  });

  test.each(['install', 'migrate', 'verify', 'uninstall'])(
    '%s rejects missing, ambiguous, and invalid scope without writing',
    (command) => {
      const root = tempRoot('dverity-scope-');
      const before = fs.readdirSync(root);

      expect(run([command]).status).not.toBe(0);
      expect(run([command, '--global', '--project', root]).status).not.toBe(0);
      expect(run([command, '--project', 'relative-root']).status).not.toBe(0);
      expect(run([command, '--project', path.join(root, 'missing')]).status).not.toBe(0);
      expect(fs.readdirSync(root)).toEqual(before);

      const realParent = tempRoot('dverity-scope-link-');
      const realRoot = path.join(realParent, 'real/root');
      const linkedParent = path.join(realParent, 'linked');
      fs.mkdirSync(realRoot, { recursive: true });
      fs.symlinkSync(path.join(realParent, 'real'), linkedParent, 'dir');
      const linkedRoot = path.join(linkedParent, 'root');
      const linkedBefore = snapshot(realRoot);
      const linkedResult = run([command, '--project', linkedRoot]);
      expect(linkedResult.status).not.toBe(0);
      expect(linkedResult.stderr).toMatch(/symlink/i);
      expect(snapshot(realRoot)).toBe(linkedBefore);
    }
  );

  test('installs the exact nine Skills into both projections with one ownership manifest', () => {
    const parent = tempRoot('dverity-install-');
    const root = path.join(parent, 'project');
    const otherRoot = path.join(parent, 'other');
    const outside = path.join(parent, 'outside.txt');
    write(path.join(root, '.agents/skills/user-skill/SKILL.md'), 'user-owned\n');
    write(path.join(root, '.dverity/config.yml'), 'user: config\n');
    write(path.join(otherRoot, 'sentinel.txt'), 'other root\n');
    write(outside, 'outside\n');
    const otherBefore = snapshot(otherRoot);
    const outsideBefore = snapshot(outside);

    const result = run(['install', '--project', root]);

    expect(result.status).toBe(0);
    const unresolved = [];
    for (const projection of ['.agents/skills', '.claude/skills']) {
      for (const id of SKILL_IDS) {
        const skillRoot = path.join(root, projection, id);
        const skillFile = path.join(skillRoot, 'SKILL.md');
        expect(fs.existsSync(skillFile)).toBe(true);
        const metadata = matter(fs.readFileSync(skillFile, 'utf8')).data.metadata;
        for (const relative of [...(metadata.reads || []), ...(metadata.resources || [])]) {
          const dependency = path.resolve(skillRoot, relative);
          if (!fs.existsSync(dependency)) unresolved.push(dependency);
        }
      }
    }
    expect(unresolved).toEqual([]);
    expect(fs.readFileSync(path.join(root, '.agents/skills/user-skill/SKILL.md'), 'utf8'))
      .toBe('user-owned\n');
    expect(fs.readFileSync(path.join(root, '.dverity/config.yml'), 'utf8'))
      .toBe('user: config\n');

    const manifest = JSON.parse(fs.readFileSync(
      path.join(root, '.dverity/managed-skills.json'),
      'utf8'
    ));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.package).toEqual({ name: 'dverity', version: '5.0.0' });
    expect(manifest.source).toMatchObject({ root: 'skills' });
    expect(manifest.source.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(manifest.source.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.artifact).toMatchObject({ kind: 'package-content', algorithm: 'sha256' });
    expect(manifest.artifact.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.skills).toEqual(SKILL_IDS);
    expect(manifest.projections.map((item) => item.root)).toEqual([
      '.agents/skills',
      '.claude/skills'
    ]);
    expect(manifest.projections.every((item) => (
      item.files.length > 9 && item.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))
    ))).toBe(true);
    expect(manifest.transaction).toMatchObject({ state: 'committed' });
    expect(snapshot(otherRoot)).toBe(otherBefore);
    expect(snapshot(outside)).toBe(outsideBefore);
  });

  test.each([
    ['legacy-owned root', (root) => {
      write(path.join(root, '.codex/.cc-devflow-managed-skills.json'), '{}\n');
    }, /migrate/i],
    ['unknown same-name collision', (root) => {
      write(path.join(root, '.agents/skills/dverity-repair/SKILL.md'), 'unknown\n');
    }, /collision|unknown/i],
    ['unknown dependency collision', (root) => {
      write(path.join(root, '.agents/lib/dverity/review/submit.js'), 'user-owned\n');
    }, /collision|unknown/i]
  ])('install fails closed for %s', (_name, prepare, message) => {
    const root = tempRoot('dverity-collision-');
    prepare(root);
    const before = snapshot(root);

    const result = run(['install', '--project', root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(message);
    expect(snapshot(root)).toBe(before);
  });

  test('rejects a project root reached through a symlink without following it', () => {
    const parent = tempRoot('dverity-symlink-');
    const root = path.join(parent, 'root');
    const linked = path.join(parent, 'linked');
    fs.mkdirSync(root);
    fs.symlinkSync(root, linked, 'dir');
    const before = snapshot(root);

    const result = run(['install', '--project', linked]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/symlink/i);
    expect(snapshot(root)).toBe(before);
  });

  test('verify is repeatably read-only for a pristine installation', () => {
    const root = tempRoot('dverity-verify-');
    expect(run(['install', '--project', root]).status).toBe(0);
    const before = snapshot(root);

    expect(run(['verify', '--project', root]).status).toBe(0);
    expect(run(['verify', '--project', root]).status).toBe(0);
    expect(snapshot(root)).toBe(before);
  });

  test.each([
    ['missing', (file) => fs.rmSync(file), /missing.*SKILL\.md/i],
    ['missing dependency', (_file, root) => {
      fs.rmSync(path.join(root, '.agents/lib/dverity/review/submit.js'));
    }, /missing.*submit\.js/i],
    ['drift', (file) => fs.writeFileSync(file, 'drift\n'), /drift.*SKILL\.md/i],
    ['unknown', (_file, root) => {
      write(path.join(root, '.agents/skills/dverity-repair/unknown.txt'), 'unknown\n');
    }, /unknown.*unknown\.txt/i]
  ])('verify locates %s state without changing it', (_name, mutate, message) => {
    const root = tempRoot('dverity-verify-fail-');
    expect(run(['install', '--project', root]).status).toBe(0);
    const managed = path.join(root, '.agents/skills/dverity-repair/SKILL.md');
    mutate(managed, root);
    const before = snapshot(root);

    const result = run(['verify', '--project', root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(message);
    expect(snapshot(root)).toBe(before);
  });

  test('verify fails closed for a missing ownership manifest without mutation', () => {
    const root = tempRoot('dverity-verify-missing-manifest-');
    expect(run(['install', '--project', root]).status).toBe(0);
    fs.rmSync(path.join(root, '.dverity/managed-skills.json'));
    const before = snapshot(root);

    const result = run(['verify', '--project', root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/manifest.*missing/i);
    expect(snapshot(root)).toBe(before);
  });

  test('uninstall removes only manifest-proven Skills and preserves user data', () => {
    const parent = tempRoot('dverity-uninstall-');
    const root = path.join(parent, 'project');
    const otherRoot = path.join(parent, 'other');
    fs.mkdirSync(root);
    write(path.join(root, '.dverity/config.yml'), 'keep config\n');
    write(path.join(root, 'docs/postmortems/keep.md'), 'keep evidence\n');
    write(path.join(root, '.agents/skills/user-skill/SKILL.md'), 'keep skill\n');
    write(path.join(otherRoot, 'sentinel.txt'), 'keep other root\n');
    expect(run(['install', '--project', root]).status).toBe(0);
    const otherBefore = snapshot(otherRoot);

    const result = run(['uninstall', '--project', root]);

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(root, '.dverity/managed-skills.json'))).toBe(false);
    for (const projection of ['.agents/skills', '.claude/skills']) {
      expect(SKILL_IDS.some((id) => fs.existsSync(path.join(root, projection, id)))).toBe(false);
    }
    for (const host of ['.agents', '.claude']) {
      expect(fs.existsSync(path.join(root, host, 'lib/dverity/review/submit.js'))).toBe(false);
    }
    expect(fs.readFileSync(path.join(root, '.dverity/config.yml'), 'utf8')).toBe('keep config\n');
    expect(fs.readFileSync(path.join(root, 'docs/postmortems/keep.md'), 'utf8'))
      .toBe('keep evidence\n');
    expect(fs.readFileSync(path.join(root, '.agents/skills/user-skill/SKILL.md'), 'utf8'))
      .toBe('keep skill\n');
    expect(snapshot(otherRoot)).toBe(otherBefore);
  });

  test.each([
    ['drifted file', (root) => {
      fs.writeFileSync(path.join(root, '.claude/skills/postmortem/SKILL.md'), 'drift\n');
    }, /drift/i],
    ['invalid manifest', (root) => {
      fs.writeFileSync(path.join(root, '.dverity/managed-skills.json'), '{"schemaVersion":1}\n');
    }, /invalid.*manifest/i]
  ])('uninstall fails without mutation for %s', (_name, mutate, message) => {
    const root = tempRoot('dverity-uninstall-fail-');
    expect(run(['install', '--project', root]).status).toBe(0);
    mutate(root);
    const before = snapshot(root);

    const result = run(['uninstall', '--project', root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(message);
    expect(snapshot(root)).toBe(before);
  });

  test.each([
    ['manifest parent collision', (root) => write(path.join(root, '.dverity'), 'not a dir\n')],
    ['dangling same-name collision', (root) => {
      const target = path.join(root, '.agents/skills/dverity-repair');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(path.join(root, 'missing-target'), target, 'dir');
    }]
  ])('install rolls back every path for %s', (_name, prepare) => {
    const root = tempRoot('dverity-install-rollback-');
    prepare(root);
    const before = snapshot(root);

    expect(run(['install', '--project', root]).status).not.toBe(0);
    expect(snapshot(root)).toBe(before);
  });

  test('global and project scopes remain isolated in disposable roots', () => {
    const parent = tempRoot('dverity-global-project-');
    const globalRoot = path.join(parent, 'global');
    const projectRoot = path.join(parent, 'project');
    const outside = path.join(parent, 'outside.txt');
    fs.mkdirSync(globalRoot);
    fs.mkdirSync(projectRoot);
    write(outside, 'outside\n');
    const env = { ...process.env, HOME: globalRoot };

    expect(run(['install', '--global'], { env }).status).toBe(0);
    const globalInstalled = snapshot(globalRoot);
    expect(run(['install', '--project', projectRoot], { env }).status).toBe(0);
    expect(snapshot(globalRoot)).toBe(globalInstalled);
    const projectInstalled = snapshot(projectRoot);
    const outsideBefore = snapshot(outside);

    expect(run(['uninstall', '--global'], { env }).status).toBe(0);
    expect(snapshot(projectRoot)).toBe(projectInstalled);
    expect(snapshot(outside)).toBe(outsideBefore);
  });

  test('preserves an unknown file that collides with the temporary manifest path', () => {
    const root = tempRoot('dverity-temp-collision-');
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const temporary = path.join(root, `.dverity/managed-skills.json.tmp-${id}`);
    write(temporary, 'user-owned\n');
    const before = snapshot(root);
    const uuid = jest.spyOn(crypto, 'randomUUID').mockReturnValue(id);
    const { resolveScope, runLifecycle } = require('../../install/lifecycle');

    expect(() => runLifecycle('install', resolveScope(['--project', root]))).toThrow();
    expect(snapshot(root)).toBe(before);
    uuid.mockRestore();
  });
});
