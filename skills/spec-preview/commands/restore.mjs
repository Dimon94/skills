// ==========================================================================
// L3: 从 Spec Issue 附件重建对比页。渲染及发布复用 compare.mjs 的 renderCompare。
// L4: 成功返回 compare/preview.html 的绝对路径，HTML 与归档前逐字节一致。
// L5: files 包含版本为 vN 的确认版和版本为 v(N+1)、stage 为 done 的实现版。文件名和顺序任意。
// L6: 读回并校验版本对 → 在用户缓存重建。附件校验失败报 BLOCKED，缓存目录原样保留。
// TEST: skills/spec-preview/tests/scenarios.test.mjs 的 S9
// ==========================================================================
import { readFileSync } from 'node:fs';
import { renderCompare } from './compare.mjs';
import { previewDirectory } from '../preview-dir.mjs';
import { PreviewError } from '../preview-error.mjs';

function readAttachment(path) {
  let bytes;
  let spec;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (!error.code) throw error;
    throw new PreviewError('BLOCKED', `无法读取 ${path}（${error.code}）。请重新下载附件。`);
  }
  try {
    spec = JSON.parse(bytes);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new PreviewError('BLOCKED', `${path} 不是有效的 JSON。请重新下载附件。`);
  }
  if (!Number.isSafeInteger(spec?.version) || spec.version < 1) {
    throw new PreviewError('BLOCKED', `${path} 缺少正整数版本。请核对 Spec Issue 的附件。`);
  }
  return { bytes, spec };
}

export function restore(ref, files) {
  if (files.length !== 2 || !files.every(path => typeof path === 'string' && path.trim())) {
    throw new PreviewError('BLOCKED', '请提供从 Spec Issue 下载的两份 JSON 附件路径。');
  }
  const directory = previewDirectory(ref);
  const [locked, built] = files.map(readAttachment).sort((a, b) => a.spec.version - b.spec.version);
  const version = locked.spec.version;
  if (built.spec.version !== version + 1 || built.spec.stage !== 'done') {
    throw new PreviewError('BLOCKED', '实现版需要紧接确认版的版本号，且 stage 为 done。请核对 Spec Issue 的附件。');
  }
  try {
    return renderCompare(directory, `spec-v${version}.json`, locked.bytes, built.spec);
  } catch (error) {
    if (error instanceof PreviewError || !error.code) throw error;
    throw new PreviewError('BLOCKED', `无法重建 ${directory} 的对比页（${error.code}）。请检查缓存目录后重试。`);
  }
}
