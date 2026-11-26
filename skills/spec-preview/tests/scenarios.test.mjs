import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = fileURLToPath(new URL('../spec-preview.mjs', import.meta.url));
const fixture = readFileSync(new URL('fixtures/spec.json', import.meta.url));
const deltaFixture = readFileSync(new URL('fixtures/delta-items.json', import.meta.url), 'utf8');
const smywFixture = fileURLToPath(new URL('fixtures/smyw/', import.meta.url));
const ref = ['my-skills', 'DD-654'];
const feedback = name => fileURLToPath(new URL(`fixtures/feedback-${name}.md`, import.meta.url));

function previewSession(t) {
  const home = mkdtempSync(join(tmpdir(), 'spec-preview-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const smywDir = resolve(process.env.SMYW_DIR || smywFixture);
  const renderer = join(smywDir, 'scripts', 'build.mjs');
  const { FORCE_COLOR, COLORTERM, ...testEnv } = process.env;
  const cache = join(home, 'cache');
  const env = { ...testEnv, HOME: home, XDG_CACHE_HOME: cache, SMYW_DIR: smywDir };
  const directory = join(cache, 'dverity', 'spec-preview', ...ref);
  const run = (command, overrides, ...args) => spawnSync(process.execPath, [cli, command, ...ref, ...args], {
    cwd: repo, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000,
  });
  return { env, renderer, home, directory, run };
}

function stdoutOf(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function rejectsWith(result, code) {
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.startsWith(`${code}\t`), result.stderr);
}

function buildV1({ directory, run }) {
  assert.equal(stdoutOf(run('init')), directory);
  writeFileSync(join(directory, 'spec.json'), fixture);
  assert.equal(stdoutOf(run('build')), join(directory, 'preview.html'));
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
test('S2 修改与确认后返回新版本和锁', (t) => {
  const session = previewSession(t);
  const { directory, run } = session;
  buildV1(session);
  assert.equal(stdoutOf(run('apply', {}, feedback('structure'))), '2');
  rejectsWith(run('apply', {}, feedback('structure')), 'BLOCKED');
  rejectsWith(run('apply', {}, feedback('confirm')), 'MissingEvidence');
  rejectsWith(run('confirm', {}, feedback('confirm')), 'MissingEvidence');
  stdoutOf(run('build'));
  const frozen = readFileSync(join(directory, 'spec-v2.json'));
  assert.equal(JSON.parse(frozen).pages[0].root.children[0].label, '保存任务备注');
  const lock = `Preview: v2 sha256:${createHash('sha256').update(frozen).digest('hex')}`;
  writeFileSync(join(directory, 'spec.json'), JSON.stringify(JSON.parse(frozen)));
  const files = readdirSync(directory).sort();
  assert.equal(stdoutOf(run('confirm', {}, feedback('confirm'))), lock);
  assert.deepEqual(readdirSync(directory).sort(), files);
  const published = join(directory, '..', 'DD-655');
  mkdirSync(published);
  rejectsWith(run('rekey', {}, 'my-skills', 'DD-655'), 'BLOCKED');
  assert.deepEqual(readdirSync(published), []);
  assert.deepEqual(readdirSync(directory).sort(), files);
  rmSync(published, { recursive: true });
  assert.equal(stdoutOf(run('rekey', {}, 'my-skills', 'DD-655')), '');
  assert.equal(existsSync(directory), false);
  assert.deepEqual(readdirSync(published).sort(), files);
  assert.deepEqual(readFileSync(join(published, 'spec-v2.json')), frozen);
  rejectsWith(run('rekey', {}, 'my-skills', 'DD-655'), 'MissingEvidence');
});
test('S3 存在未处理的必须改时拒绝确认', (t) => {
  const session = previewSession(t);
  const { directory, run } = session;
  buildV1(session);
  const files = readdirSync(directory).sort();
  rejectsWith(run('confirm', {}, feedback('must-fix')), 'NotConfirmed');
  rejectsWith(run('confirm', {}, feedback('structure')), 'NotConfirmed');
  assert.deepEqual(readdirSync(directory).sort(), files);
  assert.deepEqual(readFileSync(join(directory, 'spec.json')), fixture);
  stdoutOf(run('apply', {}, feedback('structure')));
  stdoutOf(run('build'));
  assert.match(stdoutOf(run('confirm', {}, feedback('must-fix'))), /^Preview: v2 sha256:[a-f0-9]{64}$/);
});
function checkPreviewTickets({ home, env }, source, lock, claims) {
  const specPath = join(home, 'spec.md');
  const ticketsPath = join(home, 'tickets.md');
  const transitions = claims.map((_, index) => `T${index + 1}`);
  writeFileSync(specPath, `## Business Flow\n${transitions.join('\n')}\n## Dependencies\n- ${lock}\n`);
  writeFileSync(ticketsPath, claims.map((claim, index) =>
    `## DD-${index + 1}: 草稿\n- Owns: ${transitions[index]}\n- Blocked by: None\n- Preview: ${claim}\n`).join('\n'));
  const checker = join(repo, 'skills/to-tickets/scripts/check-tickets.js');
  return spawnSync(process.execPath, [checker, '--preview', source, specPath, ticketsPath], {
    cwd: repo, env, encoding: 'utf8', timeout: 15_000,
  });
}

function ticketErrors(result, status) {
  assert.ifError(result.error);
  assert.equal(result.status, status, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout.split('\n').filter(line => line.startsWith('error\t'));
}

test('S4 拆票拒绝漏认领、重复认领与未知改动项', (t) => {
  const session = previewSession(t);
  const source = join(session.home, 'spec-v1.json');
  writeFileSync(source, fixture);
  const lock = `Preview: v1 sha256:${createHash('sha256').update(fixture).digest('hex')}`;
  const check = claims => checkPreviewTickets(session, source, lock, claims);
  assert.deepEqual(ticketErrors(check(['task-note', 'submit-note', 'persist-note']), 0), []);

  const cases = [
    [['task-note', 'submit-note', ''], /^error\tpreview-uncovered\t.*persist-note/],
    [['task-note', 'submit-note, task-note', 'persist-note'], /^error\tpreview-duplicate\t.*task-note.*DD-1.*DD-2/],
    [['task-note', 'submit-note', 'persist-note', 'extra-note'], /^error\tpreview-unknown\t.*extra-note.*DD-4/],
  ];
  for (const [claims, expected] of cases) {
    const errors = ticketErrors(check(claims), 1);
    assert.equal(errors.length, 1, errors.join('\n'));
    assert.match(errors[0], expected);
  }
});

test('S5 已确认预览变更后旧锁失效', (t) => {
  const session = previewSession(t);
  const { directory, run } = session;
  buildV1(session);
  assert.equal(stdoutOf(run('apply', {}, feedback('structure'))), '2');
  stdoutOf(run('build'));
  const lock = stdoutOf(run('confirm', {}, feedback('confirm')));
  assert.match(lock, /^Preview: v2 sha256:[a-f0-9]{64}$/);
  const sha256 = lock.split('sha256:')[1];
  const frozen = join(directory, 'spec-v2.json');
  const frozenBytes = readFileSync(frozen);
  assert.deepEqual(JSON.parse(stdoutOf(run('changes', {}, '2', sha256))), [
    { id: 'task-note', kind: 'page', change: 'added' },
    { id: 'submit-note', kind: 'step', change: 'added' },
    { id: 'persist-note', kind: 'backend', change: 'added' },
  ]);
  const wrongSha = (sha256[0] === '0' ? '1' : '0') + sha256.slice(1);
  rejectsWith(run('changes', {}, '2', wrongSha), 'PreviewLockMismatch');

  assert.equal(stdoutOf(run('apply', {}, feedback('reopen'))), '3');
  assert.deepEqual(readFileSync(frozen), frozenBytes);
  rejectsWith(run('changes', {}, '2', sha256), 'PreviewLockMismatch');
  const check = checkPreviewTickets(session, join(directory, 'spec.json'), lock, ['extra-note']);
  const errors = ticketErrors(check, 1);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /^error\tpreview-lock\t/);
});
test('S6 Spec 轴逐项判定并阻塞未接受的偏差', () => assert.fail('待验证审查结论'));
test('S7 对比页使用锁定版并要求逐项证据', (t) => {
  const { directory, run } = previewSession(t);
  stdoutOf(run('init'));
  const locked = join(directory, 'spec-v2.json');
  const frozen = JSON.stringify({ ...JSON.parse(fixture), version: 2, versionNote: '确认版' });
  const sha256 = createHash('sha256').update(frozen).digest('hex');
  writeFileSync(locked, frozen);
  const draft = JSON.stringify({ ...JSON.parse(fixture), version: 3, title: '未确认草稿' });
  for (const file of ['spec-v3.json', 'spec.json']) writeFileSync(join(directory, file), draft);
  const originals = readdirSync(directory).sort();
  const asBuilt = fileURLToPath(new URL('fixtures/compare-as-built.json', import.meta.url));
  const verdicts = JSON.parse(readFileSync(new URL('fixtures/compare-verdicts.json', import.meta.url)));
  const compare = (items = verdicts, overrides = {}, hash = sha256) =>
    run('compare', overrides, '2', hash, asBuilt, JSON.stringify(items));
  const output = join(directory, 'compare');
  const html = join(output, 'preview.html');

  assert.equal(stdoutOf(compare()), html);
  const page = readFileSync(html, 'utf8');
  for (const evidence of [
    '保存备注的真实交付', '对比结论', 'task-note', '偏差', '截图/保存并关闭.png', '已接受',
    '可以在保存后关闭弹层。', 'submit-note', '一致', 'src/note.mjs:42', 'src/note.test.mjs:26',
    'persist-note', '缺失', 'src/notes-api.mjs:12', 'extra:close-note', '计划外', 'src/note.mjs:48',
  ]) assert.ok(page.includes(evidence), `对比页缺少 ${evidence}`);
  assert.doesNotMatch(page, /未确认草稿/);
  const built = JSON.parse(readFileSync(join(output, 'spec.json'), 'utf8'));
  assert.equal(built.stage, 'done');
  assert.equal(built.version, 3);
  assert.equal(readFileSync(join(output, 'spec-v2.json'), 'utf8'), frozen);
  assert.equal(createHash('sha256').update(readFileSync(locked)).digest('hex'), sha256);
  assert.equal(readFileSync(join(directory, 'spec-v3.json'), 'utf8'), draft);
  assert.equal(readFileSync(join(directory, 'spec.json'), 'utf8'), draft);
  assert.deepEqual(readdirSync(directory).sort(), ['compare', ...originals]);
  assert.equal(stdoutOf(compare()), html);

  rmSync(output, { recursive: true });
  delete verdicts[0].evidence.screenshot;
  const missing = compare();
  rejectsWith(missing, 'MissingEvidence');
  assert.match(missing.stderr, /^task-note\.screenshot$/m);
  rejectsWith(compare(verdicts, {}, '0'.repeat(64)), 'PreviewLockMismatch');
  assert.deepEqual(readdirSync(directory).sort(), originals);

  const status = () => execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' });
  const before = status();
  const repoCache = join(repo, 'dd-661-test-cache');
  rejectsWith(compare(verdicts, { XDG_CACHE_HOME: repoCache }), 'InsideRepo');
  assert.equal(existsSync(repoCache), false);
  assert.equal(status(), before);
});
test('S8 附件读回后才删除本地预览', () => assert.fail('待验证合入归档'));
test('S9 归档附件重建相同的预览', () => assert.fail('待验证恢复预览'));
test('S10 构建产物与 smyw 一致且保留交互', (t) => {
  const session = previewSession(t);
  const { directory, env, home, renderer, run } = session;
  buildV1(session);
  assert.equal(stdoutOf(run('apply', {}, feedback('structure'))), '2');
  stdoutOf(run('build'));
  const roundTwo = join(home, 'feedback-v2.md');
  writeFileSync(roundTwo, readFileSync(feedback('structure'), 'utf8')
    .replaceAll('方案 v1', '方案 v2').replace('"base": 1', '"base": 2').replaceAll('保存任务备注', '保存并返回'));
  assert.equal(stdoutOf(run('apply', {}, roundTwo)), '3');
  const html = readFileSync(stdoutOf(run('build')));
  const direct = join(directory, 'direct.html');
  execFileSync(process.execPath, [renderer, join(directory, 'spec.json'), '-o', direct], { cwd: repo, env, timeout: 15_000 });
  assert.deepEqual(html, readFileSync(direct));

  const labels = ['保存备注', '保存任务备注', '保存并返回'];
  for (const [index, label] of labels.entries()) {
    const archived = JSON.parse(readFileSync(join(directory, `spec-v${index + 1}.json`), 'utf8'));
    assert.equal(archived.pages[0].root.children[0].label, label);
  }
  if (renderer !== join(smywFixture, 'scripts/build.mjs')) {
    const embedded = /<script type="application\/json" id="smyw-versions">([^<]+)<\/script>/.exec(html.toString());
    assert.ok(embedded, 'smyw HTML 缺少版本数据');
    const versions = JSON.parse(embedded[1]).filter(({ version }) => version > 0);
    assert.deepEqual(versions.map(({ version }) => version), [1, 2, 3]);
    assert.deepEqual(versions.map(({ spec }) => spec.pages[0].root.children[0].label), labels);
  }
});
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
test('S12 小需求生成带双侧证据的变更预览', (t) => {
  const { directory, run } = previewSession(t);
  const gitStatus = () => execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' });
  const before = gitStatus();
  const html = join(directory, 'preview.html');
  const archive = join(directory, 'spec-v1.json');
  assert.equal(stdoutOf(run('delta', {}, deltaFixture)), html);
  assert.ok(existsSync(html));
  const spec = JSON.parse(readFileSync(archive, 'utf8'));
  assert.equal(spec.stage, 'done');
  assert.equal(spec.version, 1);

  const page = spec.pages.find(page => page.id === 'save-button');
  assert.equal(page.change, 'modified');
  const image = page.root.children.find(node => node.type === 'image');
  assert.equal(image.before.label, '截图/提交.png');
  assert.equal(image.label, '截图/保存.png');
  const field = spec.backend[0].items.find(item => item.id === 'note-field');
  assert.equal(field.change, 'added');
  assert.equal(field.before.note, 'src/task.mjs:12');
  assert.equal(field.note, 'src/task.mjs:18');
  assert.equal(stdoutOf(run('delta', {}, deltaFixture)), html);

  const repoCache = join(repo, 'dd-659-test-cache');
  const inside = run('delta', { XDG_CACHE_HOME: repoCache }, deltaFixture);
  assert.ifError(inside.error);
  assert.equal(inside.status, 1);
  assert.match(inside.stderr, /^InsideRepo\t/);
  assert.equal(existsSync(repoCache), false);
  assert.equal(gitStatus(), before);

  writeFileSync(join(directory, 'spec-v2.json'), JSON.stringify({ version: 2, stage: 'done' }));
  const locked = run('delta', {}, deltaFixture);
  assert.ifError(locked.error);
  assert.equal(locked.status, 1);
  assert.match(locked.stderr, /^BLOCKED\t.*对比页/);
  assert.deepEqual(JSON.parse(readFileSync(archive, 'utf8')), spec);
});

test('S13 bug 变更预览要求改前和改后检查输出', (t) => {
  const { directory, run } = previewSession(t);
  const item = {
    id: 'refresh-list', kind: 'step', change: 'modified',
    before: { code: ['src/task.mjs:24'], check: 'FAIL: list is stale' },
    after: { code: ['src/task.mjs:27'] },
  };
  const missing = run('delta', {}, JSON.stringify([item]));
  assert.ifError(missing.error);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^MissingEvidence\t[^\n]*\nrefresh-list\.after\.check\s*$/);
  assert.equal(existsSync(directory), false);

  item.after.check = 'PASS: list refreshed';
  const html = stdoutOf(run('delta', {}, JSON.stringify([item])));
  const output = readFileSync(html, 'utf8');
  assert.match(output, /FAIL: list is stale/);
  assert.match(output, /PASS: list refreshed/);
});
test('S14 任务按固定顺序判定规模并读回标签', () => assert.fail('待验证规模分流'));
test('S15 小需求出现跨 Module 接口时停止并升级', () => assert.fail('待验证任务升级'));
