import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { smywScripts } from '../smyw.mjs';

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
