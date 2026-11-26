import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { smywScripts } from '../smyw.mjs';

const cli = fileURLToPath(new URL('../spec-preview.mjs', import.meta.url));
const spec = new URL('fixtures/spec.json', import.meta.url);
const frozenErrors = /^(InsideRepo|NotConfirmed|PreviewLockMismatch|MissingEvidence|CopyLint|BLOCKED)\t/;

test('未实现的子命令接收冻结的位置参数并报错，预览目录没有新增文件', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'spec-preview-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  copyFileSync(spec, join(directory, 'spec.json'));
  const before = readdirSync(directory, { recursive: true }).sort();
  const ref = ['my-skills', 'DD-654'];
  const lock = ['1', 'a'.repeat(64)];
  const argumentsByCommand = {
    apply: [...ref, 'feedback.md'],
    confirm: [...ref, 'feedback.md'],
    changes: [...ref, ...lock],
    compare: [...ref, ...lock, 'as-built.json', '[]'],
    delta: [...ref, '[]'],
    rekey: [...ref, 'my-skills', 'DD-655'],
    restore: [...ref, '["spec.json"]'],
  };
  const env = { ...process.env, HOME: directory, XDG_CACHE_HOME: directory, SMYW_DIR: join(directory, 'smyw') };
  for (const [command, args] of Object.entries(argumentsByCommand)) {
    const result = spawnSync(process.execPath, [cli, command, ...args], { cwd: directory, env, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 1, `${command}: ${result.stderr}`);
    assert.match(result.stderr, frozenErrors, command);
    assert.equal(result.stderr.trimEnd().split('\t')[1], `${command} 尚未实现`);
    assert.equal(result.stdout, '', command);
    assert.deepEqual(readdirSync(directory, { recursive: true }).sort(), before, command);
  }
});

test('SMYW_DIR 通过链接定位可读的构建与反馈脚本', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'spec-preview-smyw-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const checkout = join(directory, 'checkout', 'skills', 'smyw');
  mkdirSync(join(checkout, 'scripts'), { recursive: true });
  writeFileSync(join(checkout, 'scripts/build.mjs'), 'export const build = true;\n');
  writeFileSync(join(checkout, 'scripts/apply-feedback.mjs'), 'export const applyFeedback = true;\n');
  const link = join(directory, 'smyw');
  symlinkSync(checkout, link);
  const originalDir = process.env.SMYW_DIR;
  t.after(() => {
    if (originalDir === undefined) delete process.env.SMYW_DIR;
    else process.env.SMYW_DIR = originalDir;
  });
  process.env.SMYW_DIR = link;

  const { build, applyFeedback } = smywScripts();
  assert.equal(build, join(link, 'scripts/build.mjs'));
  assert.equal(applyFeedback, join(link, 'scripts/apply-feedback.mjs'));
  assert.ok(readFileSync(build).length);
  assert.ok(readFileSync(applyFeedback).length);
});
