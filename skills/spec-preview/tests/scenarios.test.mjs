import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = fileURLToPath(new URL('../spec-preview.mjs', import.meta.url));
const closeout = join(repo, 'skills/git-rebase-main/scripts/closeout-preview.mjs');
const fixture = readFileSync(new URL('fixtures/spec.json', import.meta.url));
const deltaFixture = readFileSync(new URL('fixtures/delta-items.json', import.meta.url), 'utf8');
const smywFixture = fileURLToPath(new URL('fixtures/smyw/', import.meta.url));
const ref = ['my-skills', 'DD-654'];
const feedback = name => fileURLToPath(new URL(`fixtures/feedback-${name}.md`, import.meta.url));

function previewSession(t, cwd = repo) {
  const home = mkdtempSync(join(tmpdir(), 'spec-preview-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const smywDir = resolve(process.env.SMYW_DIR || smywFixture);
  const renderer = join(smywDir, 'scripts', 'build.mjs');
  const { FORCE_COLOR, COLORTERM, ...testEnv } = process.env;
  const cache = join(home, 'cache');
  const env = { ...testEnv, HOME: home, XDG_CACHE_HOME: cache, SMYW_DIR: smywDir };
  const directory = join(cache, 'dverity', 'spec-preview', ...ref);
  const invoke = (args, overrides) => spawnSync(process.execPath, args, {
    cwd, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000,
  });
  const run = (command, overrides, ...args) => invoke([cli, command, ...ref, ...args], overrides);
  const archive = files => invoke([closeout, ...ref, JSON.stringify(files)]);
  return { env, renderer, home, directory, run, archive };
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
test('R7 公开 CLI 只列出 Spec 声明的九个命令', (t) => {
  const { run } = previewSession(t);
  for (const command of ['unknown', 'archive']) {
    const result = run(command);
    rejectsWith(result, 'BLOCKED');
    assert.equal(result.stderr.trimEnd(),
      'BLOCKED\t可用命令：init、build、apply、confirm、changes、compare、delta、rekey、restore');
  }
});

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
test('R1 build 在调用渲染器前拒绝无效版本', (t) => {
  const { directory, home, run } = previewSession(t);
  stdoutOf(run('init'));
  const smyw = join(home, 'smyw');
  mkdirSync(join(smyw, 'scripts'), { recursive: true });
  const called = join(home, 'renderer-called');
  // 渲染探针不读取版本，也不把输入拼进任何路径。
  writeFileSync(join(smyw, 'scripts', 'build.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    "writeFileSync(process.env.RENDER_PROBE, 'called');",
    "writeFileSync(join(dirname(process.argv[2]), 'preview.html'), 'probe');",
  ].join('\n'));
  const spec = JSON.parse(fixture);
  for (const version of ['/../escaped-outside', '1', 0, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    writeFileSync(join(directory, 'spec.json'), JSON.stringify({ ...spec, version }));
    const result = run('build', { SMYW_DIR: smyw, RENDER_PROBE: called });
    rejectsWith(result, 'BLOCKED');
    assert.match(result.stderr, /正整数版本/);
    assert.equal(existsSync(called), false);
    assert.equal(existsSync(join(directory, 'preview.html')), false);
  }
});

test('R1 build 拒绝读取缓存目录外的 spec.json', (t) => {
  const { directory, home, run } = previewSession(t);
  stdoutOf(run('init'));
  const spec = join(home, 'external.json');
  writeFileSync(spec, fixture);
  symlinkSync(spec, join(directory, 'spec.json'));
  const result = run('build');
  rejectsWith(result, 'BLOCKED');
  assert.match(result.stderr, /指向缓存目录之外/);
  assert.equal(existsSync(join(directory, 'preview.html')), false);
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
test('S3 拒绝未处理的必须改与未绑定当前版本的确认', (t) => {
  const session = previewSession(t);
  const { directory, home, run } = session;
  buildV1(session);
  const files = readdirSync(directory).sort();
  rejectsWith(run('confirm', {}, feedback('must-fix')), 'NotConfirmed');
  rejectsWith(run('confirm', {}, feedback('structure')), 'NotConfirmed');
  assert.deepEqual(readdirSync(directory).sort(), files);
  assert.deepEqual(readFileSync(join(directory, 'spec.json')), fixture);
  stdoutOf(run('apply', {}, feedback('structure')));
  stdoutOf(run('build'));
  rejectsWith(run('confirm', {}, feedback('must-fix')), 'NotConfirmed');
  const confirmation = readFileSync(feedback('confirm'), 'utf8');
  const mustFix = readFileSync(feedback('must-fix'), 'utf8');
  for (const content of [
    confirmation.replace(/^> 基于方案 .*\n/m, ''),
    confirmation.replace('方案 v2', '方案 v1'),
    mustFix.replace('方案 v1', '方案 v2'),
  ]) {
    const path = join(home, 'feedback.md');
    writeFileSync(path, content);
    rejectsWith(run('confirm', {}, path), 'NotConfirmed');
  }
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
test('S6 Spec 轴逐项判定并阻塞未接受的偏差', async (t) => {
  const { changeItems } = await import('../lib/change-items.cjs');
  const script = fileURLToPath(new URL('../../code-review/scripts/item-verdicts.js', import.meta.url));
  const specPath = fileURLToPath(new URL('fixtures/spec.json', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'item-verdicts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const verdictsPath = join(directory, 'verdicts.json');
  const run = (verdicts, status) => {
    writeFileSync(verdictsPath, JSON.stringify(verdicts));
    const result = spawnSync(process.execPath, [script, specPath, verdictsPath], { encoding: 'utf8', timeout: 15_000 });
    assert.ifError(result.error);
    assert.equal(result.status, status, result.stderr);
    return result;
  };
  const page = { id: 'task-note', verdict: 'match', evidence: { screenshot: '任务备注.png' } };
  const step = { id: 'submit-note', verdict: 'match', evidence: { code: ['src/note.mjs:42'] } };
  const backend = { id: 'persist-note', verdict: 'missing' };
  const extra = { id: 'extra:按钮', verdict: 'extra' };
  const pending = [page, step, backend, extra];
  assert.deepEqual(new Set(changeItems(JSON.parse(fixture)).map(({ id }) => id)),
    new Set(pending.filter(({ verdict }) => verdict !== 'extra').map(({ id }) => id)));

  const missing = { id: 'persist-note', severity: 'P1', verdict: 'missing', rule: 'unaccepted' };
  const added = { id: 'extra:按钮', severity: 'P1', verdict: 'extra', rule: 'unaccepted' };
  assert.deepEqual(JSON.parse(run(pending, 1).stdout), {
    verdict: 'BLOCK', findings: [missing, added], verdicts: pending,
  });

  const acceptedExtra = { ...extra, accepted: '保留新按钮。' };
  const partial = [page, step, backend, acceptedExtra];
  assert.deepEqual(JSON.parse(run(partial, 1).stdout), {
    verdict: 'BLOCK', findings: [missing], verdicts: partial,
  });

  const accepted = [
    { ...page, verdict: 'deviation', accepted: '接受页面偏差。' },
    step,
    { ...backend, accepted: '本次可以不持久化。' },
    acceptedExtra,
  ];
  assert.deepEqual(JSON.parse(run(accepted, 0).stdout), { verdict: 'PASS', findings: [], verdicts: accepted });

  const incomplete = run([page, backend, extra], 2);
  assert.match(incomplete.stderr, /^verdict-missing\t.*submit-note/);
  assert.equal(incomplete.stdout, '');
  const unknown = run([...pending, { id: 'unknown-note', verdict: 'match' }], 2);
  assert.match(unknown.stderr, /^verdict-unknown\t.*unknown-note/);
  assert.equal(unknown.stdout, '');
});
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
function compareAttachments(t, previousCompare = false) {
  const { directory, home, run, archive } = previewSession(t);
  assert.equal(stdoutOf(run('init')), directory);
  const asBuilt = fileURLToPath(new URL('fixtures/compare-as-built.json', import.meta.url));
  const verdicts = readFileSync(new URL('fixtures/compare-verdicts.json', import.meta.url), 'utf8');
  if (previousCompare) {
    writeFileSync(join(directory, 'spec-v1.json'), fixture);
    const hash = createHash('sha256').update(fixture).digest('hex');
    stdoutOf(run('compare', {}, '1', hash, asBuilt, verdicts));
  }
  const frozen = JSON.stringify({ ...JSON.parse(fixture), version: 2, versionNote: '确认版' });
  writeFileSync(join(directory, 'spec-v2.json'), frozen);
  writeFileSync(join(directory, 'spec.json'), frozen);
  const lock = stdoutOf(run('confirm', {}, feedback('confirm')));
  const sha256 = createHash('sha256').update(frozen).digest('hex');
  assert.equal(lock, `Preview: v2 sha256:${sha256}`);
  const html = stdoutOf(run('compare', {}, '2', sha256, asBuilt, verdicts));
  const files = ['下载的实现版.json', '下载的确认版.json'].map(name => join(home, name));
  writeFileSync(files[0], readFileSync(join(directory, 'compare', 'spec.json')));
  writeFileSync(files[1], readFileSync(join(directory, 'compare', 'spec-v2.json')));
  return { directory, run, html, files, archive };
}

test('S8 附件读回后才删除本地预览', (t) => {
  const { directory, files, archive } = compareAttachments(t, true);
  const gitStatus = () => execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' });
  const before = gitStatus();
  const entries = () => readdirSync(directory, { recursive: true }).sort();
  const originals = entries();
  const built = readFileSync(files[0]);
  writeFileSync(files[0], Buffer.concat([built, Buffer.from('\n')]));
  for (const attachments of [files, files.slice(0, 1), [...files, files[0]]]) {
    rejectsWith(archive(attachments), 'BLOCKED');
    assert.deepEqual(entries(), originals);
  }
  writeFileSync(files[0], built);
  assert.equal(stdoutOf(archive(files)), directory);
  assert.equal(existsSync(directory), false);
  assert.equal(gitStatus(), before);
});

test('S9 归档附件重建相同的预览', (t) => {
  const { directory, run, html, files, archive } = compareAttachments(t);
  const original = readFileSync(html);
  assert.equal(stdoutOf(archive(files)), directory);
  assert.equal(existsSync(directory), false);

  const built = readFileSync(files[0]);
  writeFileSync(files[0], JSON.stringify({ ...JSON.parse(built), version: 4 }));
  rejectsWith(run('restore', {}, JSON.stringify(files)), 'BLOCKED');
  assert.equal(existsSync(directory), false);
  writeFileSync(files[0], built);
  const restored = stdoutOf(run('restore', {}, JSON.stringify(files)));
  assert.equal(restored, join(directory, 'compare', 'preview.html'));
  assert.deepEqual(readFileSync(restored), original);
});
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
  assert.match(stderr[1], /pages\[0\]\.root\.children\[0\]\.label.*中英文之间缺空格/);
  assert.match(stderr[2], /flows\[0\]\.steps\[0\]\.text.*QuuxTerm/);
  assert.match(stderr[3], /backend\[0\]\.items\[0\]\.name.*中英文之间缺空格/);
  const html = join(directory, 'preview.html');
  assert.equal(existsSync(html), false);
  assert.equal(existsSync(join(directory, 'spec-v1.json')), false);

  spec.pages[0].root.children[0].label = '确认 Spec 预览';
  spec.flows[0].steps[0].text = '通过 to-spec 打开 Linear Issue，按 R11 构建 HTML 预览';
  spec.backend[0].items[0].name = '构建失败时报告 MissingEvidence，成功时读取 previewHtml 路径';
  writeFileSync(source, JSON.stringify(spec));
  assert.equal(stdoutOf(run('build')), html);
  assert.ok(readFileSync(html).includes('确认 Spec 预览'));
  assert.ok(readFileSync(html).includes(spec.flows[0].steps[0].text));
});

test('R9 在所有可见文案检查术语，允许词汇表正文使用过的多义词', (t) => {
  const { directory, run } = previewSession(t);
  stdoutOf(run('init'));
  const source = join(directory, 'spec.json');
  const spec = JSON.parse(fixture);
  Object.assign(spec, {
    title: '确认Spec 预览',
    summary: '核对史诗',
    changes: [{ text: '新增史诗' }],
    questions: [{ q: '史诗是什么？' }],
    versionNote: '补充史诗',
  });
  spec.flows[0].name = '新增 plugin 与 MVP';
  spec.flows[0].steps[0].text = '由 Coordinator 用 oracle 核对 Increment';
  writeFileSync(source, JSON.stringify(spec));
  const result = run('build');
  rejectsWith(result, 'CopyLint');
  assert.match(result.stderr, /^title .*缺空格/m);
  for (const path of ['summary', 'changes[0].text', 'questions[0].q', 'versionNote']) {
    assert.match(result.stderr.split('\n').find(line => line.startsWith(path + ' ')) ?? '', /史诗.*Epic/);
  }
  assert.match(result.stderr, /^flows\[0\]\.name .*plugin.*Skill/m);
  assert.match(result.stderr, /^flows\[0\]\.name .*MVP.*MMF/m);
  assert.match(result.stderr, /^flows\[0\]\.steps\[0\]\.text .*oracle.*独立预期/m);
  assert.match(result.stderr, /^flows\[0\]\.steps\[0\]\.text .*Increment.*MMF/m);
  assert.doesNotMatch(result.stderr, /禁用术语 Coordinator/);
  assert.equal(existsSync(join(directory, 'preview.html')), false);

  const valid = JSON.parse(fixture);
  valid.summary = '确认当前阶段';
  valid.questions = [{ q: '是否确认 v6？' }];
  writeFileSync(source, JSON.stringify(valid));
  assert.equal(stdoutOf(run('build')), join(directory, 'preview.html'));
});

test('R9 词汇只取目标项目，不读取 Skill 仓的被跟踪文本', (t) => {
  const target = mkdtempSync(join(tmpdir(), 'copy-target-'));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', target]);
  const { directory, run } = previewSession(t, target);
  stdoutOf(run('init'));
  const spec = JSON.parse(fixture);
  spec.flows[0].name = '打开 blast-radius 预览';
  writeFileSync(join(directory, 'spec.json'), JSON.stringify(spec));
  const result = run('build');
  rejectsWith(result, 'CopyLint');
  assert.match(result.stderr, /^flows\[0\]\.name .*未识别术语 blast-radius/m);
});

test('R9 词汇查找忽略外部 Git 环境并处理大于 1 MiB 的匹配', (t) => {
  const target = mkdtempSync(join(tmpdir(), 'copy-target-'));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', target]);
  writeFileSync(join(target, 'terms.txt'), 'RepoLexeme\n'.repeat(110_000));
  execFileSync('git', ['-C', target, 'add', 'terms.txt']);
  const { directory, run } = previewSession(t, target);
  stdoutOf(run('init'));
  const spec = JSON.parse(fixture);
  spec.flows[0].name = '打开 RepoLexeme 预览';
  writeFileSync(join(directory, 'spec.json'), JSON.stringify(spec));
  for (const env of [{}, { GIT_DIR: join(target, 'missing-git-dir') }]) {
    assert.equal(stdoutOf(run('build', env)), join(directory, 'preview.html'));
  }
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
function checkScaleTriage(id) {
  // 清除父测试的运行标记，让子进程执行用例。
  const { NODE_TEST_CONTEXT, FORCE_COLOR, COLORTERM, ...env } = process.env;
  const result = spawnSync(process.execPath, [
    '--test', '--test-reporter=tap', `--test-name-pattern=^${id}[ -]`,
    join(repo, 'skills/dimon-mode/tests/scale-triage.test.mjs'),
  ], { env, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^# pass [1-9]\d*$/m, result.stdout);
}

test('S14 任务按固定顺序判定规模并读回标签', () => checkScaleTriage('S14'));
test('S15 小需求出现跨 Module 接口时停止并升级', () => checkScaleTriage('S15'));
