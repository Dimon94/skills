// L4: smyw 成功递增版本后返回新版本号。执行失败报 BLOCKED，无新版本报 MissingEvidence。
// L6: 核验当前源文件及归档目标后调用 smyw，构建下一版由调用方发起。
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readVersion } from '../feedback.mjs';
import { assertPreviewTarget, previewDirectory } from '../preview-dir.mjs';
import { PreviewError } from '../preview-error.mjs';
import { smywScripts } from '../smyw.mjs';

export function apply(ref, feedback) {
  const directory = previewDirectory(ref);
  const source = join(directory, 'spec.json');
  assertPreviewTarget(source, directory);
  const version = readVersion(source);
  assertPreviewTarget(join(directory, `spec-v${version}.json`), directory);

  const feedbackPath = resolve(feedback);
  const result = spawnSync(process.execPath, [smywScripts().applyFeedback, feedbackPath, source], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || result.signal;
    throw new PreviewError('BLOCKED', `smyw 无法应用反馈 ${feedbackPath}。请核对反馈与当前预览版本。\n${detail}`);
  }
  const next = readVersion(source);
  if (next <= version) {
    throw new PreviewError('MissingEvidence', `反馈 ${feedbackPath} 未生成新版本。请落实批注，或重新导出含结构修改的反馈。`);
  }
  return next;
}
