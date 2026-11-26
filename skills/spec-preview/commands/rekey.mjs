// L4: 在缓存内移动整个预览目录。草稿目录缺失报 MissingEvidence，已有目标报 BLOCKED。
import { lstatSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { previewDirectory } from '../preview-dir.mjs';
import { PreviewError } from '../preview-error.mjs';

export function rekey(from, to) {
  const source = previewDirectory(from);
  const target = previewDirectory(to);
  if (!lstatSync(source, { throwIfNoEntry: false })?.isDirectory()) {
    throw new PreviewError('MissingEvidence', `缺少草稿预览目录 ${source}。请核对草稿 id 和缓存目录。`);
  }
  if (lstatSync(target, { throwIfNoEntry: false })) {
    throw new PreviewError('BLOCKED', `Spec 预览目标 ${target} 已存在。请核对 Spec 标识和缓存目录。`);
  }
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
  } catch (error) {
    throw new PreviewError('BLOCKED', `无法将 ${source} 移至 ${target}（${error.code}）。请检查缓存目录权限后重试。`);
  }
}
