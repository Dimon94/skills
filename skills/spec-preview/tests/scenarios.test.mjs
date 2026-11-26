import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = fileURLToPath(new URL('../spec-preview.mjs', import.meta.url));
const fixture = readFileSync(new URL('fixtures/spec.json', import.meta.url));
const smywFixture = fileURLToPath(new URL('fixtures/smyw/', import.meta.url));
const ref = ['my-skills', 'DD-654'];

function previewSession(t) {
  const home = mkdtempSync(join(tmpdir(), 'spec-preview-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const smywDir = resolve(process.env.SMYW_DIR || smywFixture);
  const renderer = join(smywDir, 'scripts', 'build.mjs');
  const { FORCE_COLOR, COLORTERM, ...testEnv } = process.env;
  const cache = join(home, 'cache');
  const env = { ...testEnv, HOME: home, XDG_CACHE_HOME: cache, SMYW_DIR: smywDir };
  const directory = join(cache, 'dverity', 'spec-preview', ...ref);
  const run = (command, overrides) => spawnSync(process.execPath, [cli, command, ...ref], {
    cwd: repo, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000,
  });
  return { env, renderer, home, directory, run };
}

function stdoutOf(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// DD-654 / Testing Decisions。行为票以同名场景的公开入口替换占位断言。
test('S1 缓存目录生成预览并拒绝仓库内目标', (t) => {
  const { env, renderer, home, directory, run } = previewSession(t);
  const gitStatus = () => execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' });
  const before = gitStatus();
  assert.equal(stdoutOf(run('init', { XDG_CACHE_HOME: '' })), join(home, '.cache', 'dverity', 'spec-preview', ...ref));
  assert.equal(stdoutOf(run('init')), directory);
  const source = join(directory, 'spec.json');
  writeFileSync(source, fixture);
  const html = join(directory, 'preview.html');
  assert.equal(stdoutOf(run('build')), html);
  const direct = join(directory, 'direct.html');
  execFileSync(process.execPath, [renderer, source, '-o', direct], { cwd: repo, env, timeout: 15_000 });
  assert.deepEqual(readFileSync(html), readFileSync(direct));

  const repoCache = join(repo, 'dd-656-test-cache');
  for (const command of ['init', 'build']) {
    const result = run(command, { XDG_CACHE_HOME: repoCache });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^InsideRepo\t/);
    assert.equal(result.stdout, '');
  }
  assert.equal(existsSync(repoCache), false);
  assert.equal(gitStatus(), before);
});
test('S2 修改与确认后返回新版本和锁', () => assert.fail('待验证确认锁'));
test('S3 存在未处理的必须改时拒绝确认', () => assert.fail('待验证确认失败'));
test('S4 拆票拒绝漏认领与重复认领', () => assert.fail('待验证改动项归属'));
test('S5 已确认预览变更后旧锁失效', () => assert.fail('待验证旧锁失效'));
test('S6 Spec 轴逐项判定并阻塞未接受的偏差', () => assert.fail('待验证审查结论'));
test('S7 对比页使用锁定版并要求逐项证据', () => assert.fail('待验证对比页'));
test('S8 附件读回后才删除本地预览', () => assert.fail('待验证合入归档'));
test('S9 归档附件重建相同的预览', () => assert.fail('待验证恢复预览'));
test('S10 构建产物与 smyw 一致且保留交互', () => assert.fail('待验证 smyw 渲染与交互'));
test('S11 预览文案不合规时报告位置', (t) => {
  const { directory, run } = previewSession(t);
  assert.equal(stdoutOf(run('init')), directory);
  const source = join(directory, 'spec.json');
  const spec = JSON.parse(fixture);
  spec.pages[0].root.children[0].label = '确认Spec 预览';
  spec.flows[0].steps[0].text = '打开 QuuxTerm 预览';
  spec.backend[0].items[0].name = '读取Spec';
  writeFileSync(source, JSON.stringify(spec));

  const result = run('build');
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const stderr = result.stderr.trimEnd().split('\n');
  assert.match(stderr[0], /^CopyLint\t/);
  assert.match(stderr[1], /pages\[0\]\.root\.children\[0\]\.label/);
  assert.match(stderr[2], /flows\[0\]\.steps\[0\]\.text.*QuuxTerm/);
  assert.match(stderr[3], /backend\[0\]\.items\[0\]\.name/);
  const html = join(directory, 'preview.html');
  assert.equal(existsSync(html), false);
  assert.equal(existsSync(join(directory, 'spec-v1.json')), false);

  spec.pages[0].root.children[0].label = '确认 Spec 预览';
  spec.flows[0].steps[0].text = '打开 Spec 预览';
  spec.backend[0].items[0].name = '读取 Spec';
  writeFileSync(source, JSON.stringify(spec));
  assert.equal(stdoutOf(run('build')), html);
  assert.ok(readFileSync(html).includes('确认 Spec 预览'));
});
test('S12 小需求预览在用户确认后才合入', () => assert.fail('待验证变更预览确认'));
test('S13 bug 变更预览要求改前和改后检查输出', () => assert.fail('待验证 bug 变更证据'));
test('S14 任务按固定顺序判定规模并读回标签', () => assert.fail('待验证规模分流'));
test('S15 小需求出现跨 Module 接口时停止并升级', () => assert.fail('待验证任务升级'));
