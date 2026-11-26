// L4: 返回构建归档原始字节的 SHA-256。确认不写入缓存。
// L6: 根据当前版本检查反馈，再读对应归档。未确认报 NotConfirmed，缺归档报 MissingEvidence。
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertFeedbackConfirmed, readEvidence, readVersion } from '../feedback.mjs';
import { assertPreviewTarget, previewDirectory } from '../preview-dir.mjs';

export function confirm(ref, feedback) {
  const directory = previewDirectory(ref);
  const source = join(directory, 'spec.json');
  assertPreviewTarget(source, directory);
  const version = readVersion(source);
  assertFeedbackConfirmed(feedback, version);
  const archive = join(directory, `spec-v${version}.json`);
  assertPreviewTarget(archive, directory);
  const frozen = readEvidence(archive, '请先构建当前版本的 Spec 预览。');
  return { version, sha256: createHash('sha256').update(frozen).digest('hex') };
}
