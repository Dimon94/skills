const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../skills/git-worktree/scripts/worktree.sh');
const LINK = path.resolve(__dirname, '../scripts/link-skills.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-')));
  const main = path.join(dir, 'app');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 't@t');
  git(main, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(main, '.gitignore'), 'node_modules/\n.env\n');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'init');
  fs.mkdirSync(path.join(main, 'node_modules'));
  fs.writeFileSync(path.join(main, '.env'), 'K=1\n');
  return main;
}

function wt(main, env, ...args) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd: main, encoding: 'utf8', env: { ...process.env, ...env } });
}

function newTree(main, branch, env = {}) {
  const r = wt(main, env, 'new', branch);
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function commitIn(tree, file) {
  fs.writeFileSync(path.join(tree, file), 'x\n');
  git(tree, 'add', file);
  git(tree, 'commit', '-qm', file);
}

test('new 建树并软链主工作树的只读产物', () => {
  const main = repo();
  const tree = newTree(main, 'feat/one');
  assert.strictEqual(tree, `${main}.wt/feat-one`);
  assert.strictEqual(fs.readlinkSync(path.join(tree, 'node_modules')), path.join(main, 'node_modules'));
  assert.strictEqual(fs.readlinkSync(path.join(tree, '.env')), path.join(main, '.env'));
  assert.match(wt(main, {}, 'ls').stdout, /feat\/one\t0\t0\t/);
});

test('new 拒绝不合法的分支名，达到上限时拒绝建树', () => {
  const main = repo();
  assert.strictEqual(wt(main, {}, 'new', 'one').status, 2);
  newTree(main, 'feat/one', { WT_MAX: '1' });
  const r = wt(main, { WT_MAX: '1' }, 'new', 'feat/two');
  assert.strictEqual(r.status, 3);
  assert.ok(!fs.existsSync(`${main}.wt/feat-two`));
});

test('gc 只回收干净、有提交且已并入 main 的树；默认只报告', () => {
  const main = repo();
  const [done, dirty, open] = ['feat/done', 'feat/dirty', 'feat/open'].map((b) => newTree(main, b));
  newTree(main, 'feat/empty');
  commitIn(done, 'd.txt');
  git(main, 'merge', '-q', '--ff-only', 'feat/done');
  commitIn(dirty, 'x.txt');
  git(dirty, 'rebase', '-q', 'main');
  git(main, 'merge', '-q', '--ff-only', 'feat/dirty');
  fs.writeFileSync(path.join(dirty, 'wip.txt'), 'w\n');
  commitIn(open, 'o.txt');

  const dry = wt(main, {}, 'gc');
  assert.match(dry.stdout, /remove\tfeat\/done/);
  assert.ok(fs.existsSync(done));

  const out = wt(main, {}, 'gc', '--apply').stdout;
  assert.match(out, /keep\tfeat\/dirty\tdirty/);
  assert.match(out, /keep\tfeat\/open\tunmerged/);
  assert.match(out, /keep\tfeat\/empty\tempty/);
  assert.ok(!fs.existsSync(done));
  assert.strictEqual(git(main, 'branch', '--list', 'feat/done'), '');
  assert.ok(fs.existsSync(path.join(main, 'node_modules')));
  [dirty, open].forEach((p) => assert.ok(fs.existsSync(p)));
});

test('new 先回收已并入 main 的树，再按上限计数', () => {
  const main = repo();
  const done = newTree(main, 'feat/done', { WT_MAX: '1' });
  commitIn(done, 'd.txt');
  git(main, 'merge', '-q', '--ff-only', 'feat/done');
  newTree(main, 'feat/next', { WT_MAX: '1' });
  assert.ok(!fs.existsSync(done));
});

test('gc 不回收有进程占用的树', () => {
  const main = repo();
  const tree = newTree(main, 'feat/busy');
  commitIn(tree, 'b.txt');
  git(main, 'merge', '-q', '--ff-only', 'feat/busy');
  const child = require('child_process').spawn('sleep', ['30'], { cwd: tree });
  try {
    assert.match(wt(main, {}, 'gc', '--apply').stdout, /keep\tfeat\/busy\tin-use:1/);
    assert.ok(fs.existsSync(tree));
  } finally {
    child.kill();
  }
});

test('link-skills 在任务工作树里拒绝运行', () => {
  const main = repo();
  const tree = newTree(main, 'feat/link');
  fs.mkdirSync(path.join(tree, 'scripts'));
  fs.copyFileSync(LINK, path.join(tree, 'scripts/link-skills.sh'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const r = spawnSync('bash', [path.join(tree, 'scripts/link-skills.sh')], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_SKILLS_DIR: `${home}/c`, AGENTS_SKILLS_DIR: `${home}/a` },
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /main worktree/);
});
