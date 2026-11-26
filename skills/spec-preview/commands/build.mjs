// ==========================================================================
// L4: 成功时返回 preview.html 绝对路径，HTML 和版本归档由 smyw 生成。
// L5: smyw 进程最多运行 10 秒。超时以 BLOCKED 退出。
// L6: 核验路径 → 读 spec.json → 检查文案 → 调用原样渲染。
// ==========================================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPreviewCopy } from '../copy-lint.mjs';
import { assertPreviewTarget, previewDirectory } from '../preview-dir.mjs';
import { PreviewError } from '../preview-error.mjs';
import { renderPreview } from '../render.mjs';

function readSpec(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new PreviewError('BLOCKED', `无法读取 Spec 预览输入 ${path}：${error.message}`);
  }
}

export function build(ref) {
  const directory = previewDirectory(ref);
  const source = join(directory, 'spec.json');
  const html = join(directory, 'preview.html');
  const spec = readSpec(source);
  assertPreviewCopy(spec);
  // smyw 渲染后还会写入当前版本的归档。
  assertPreviewTarget(join(directory, `spec-v${Number(spec?.version) || 1}.json`), directory);
  assertPreviewTarget(html, directory);
  return renderPreview(source, html);
}
