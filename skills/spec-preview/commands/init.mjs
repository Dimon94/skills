// L4: 创建并返回用户缓存目录。拒绝仓库内目标，重复调用保留已有文件。
import { mkdirSync } from 'node:fs';
import { previewDirectory } from '../preview-dir.mjs';

export function init(ref) {
  const directory = previewDirectory(ref);
  mkdirSync(directory, { recursive: true });
  return directory;
}
