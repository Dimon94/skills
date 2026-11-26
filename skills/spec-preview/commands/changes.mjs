// ==========================================================================
// L3: changes 是锁定预览改动项的 CLI 入口，共用 lib/change-items.cjs。
// L4: 只读。锁不符报 PreviewLockMismatch，缺文件报 MissingEvidence。
// L5: lock.version 对应当前 spec.json，lock.sha256 对应版本归档的原始字节。
// L6: 核验当前版本 → 读取归档并核验 SHA-256 → 提取改动项。
// TEST: skills/spec-preview/tests/scenarios.test.mjs 的 S5
// ==========================================================================
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readEvidence, readVersion } from '../feedback.mjs';
import { changeItems } from '../lib/change-items.cjs';
import { assertPreviewTarget, previewDirectory } from '../preview-dir.mjs';
import { PreviewError } from '../preview-error.mjs';

export function changes(ref, lock) {
  const directory = previewDirectory(ref);
  const source = join(directory, 'spec.json');
  assertPreviewTarget(source, directory);
  const version = readVersion(source);
  if (version !== lock.version) {
    throw new PreviewError('PreviewLockMismatch', `当前预览为 v${version}，锁定版为 v${lock.version}。请重新确认当前预览。`);
  }

  const archive = join(directory, `spec-v${version}.json`);
  assertPreviewTarget(archive, directory);
  const frozen = readEvidence(archive, '请先构建当前版本的 Spec 预览。');
  if (createHash('sha256').update(frozen).digest('hex') !== lock.sha256) {
    throw new PreviewError('PreviewLockMismatch', `${archive} 的 SHA-256 与锁定行不一致。请重新确认当前预览。`);
  }
  let spec;
  try {
    spec = JSON.parse(frozen);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new PreviewError('BLOCKED', `无法解析 ${archive}：${error.message}。请重新构建并确认预览。`);
  }
  return changeItems(spec);
}
