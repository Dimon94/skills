// ==========================================================================
// L3: 合入收尾内部的附件核验与缓存清理。见 repo://skills/git-rebase-main/references/closeout.md#预览门。
// L4: 成功返回已删除的缓存目录。附件核验失败报 BLOCKED 并保留缓存。
// L5: files 是从 Spec Issue 下载的两份 JSON 路径。以 SHA-256 多重集核验，文件名和顺序任意。
// L6: 核验 compare/ 的确认版和实现版 → 核对附件字节 → 删除该 Issue 的缓存目录。
// TEST: skills/spec-preview/tests/scenarios.test.mjs 的 S8
// ==========================================================================
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { assertPreviewTarget, previewDirectory } from '../../spec-preview/preview-dir.mjs';
import { PreviewError } from '../../spec-preview/preview-error.mjs';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function comparisonFiles(directory) {
  const compare = join(directory, 'compare');
  assertPreviewTarget(compare, directory);
  const versions = readdirSync(compare).filter(name => /^spec-v.*\.json$/.test(name));
  if (versions.length !== 1 || !/^spec-v[1-9]\d*\.json$/.test(versions[0])) {
    throw new PreviewError('BLOCKED', `${compare} 需要唯一的确认版 JSON。请重新生成对比页。`);
  }
  const paths = [join(compare, versions[0]), join(compare, 'spec.json')];
  for (const path of paths) assertPreviewTarget(path, compare);
  return paths;
}

function archive(ref, files) {
  const directory = previewDirectory(ref);
  try {
    if (!lstatSync(directory).isDirectory()) {
      throw new PreviewError('BLOCKED', `${directory} 需要独立的缓存目录。请重新生成对比页。`);
    }
    const expected = comparisonFiles(directory).map(digest).sort();
    const actual = files.map(digest).sort();
    if (expected[0] !== actual[0] || expected[1] !== actual[1]) {
      throw new PreviewError('BLOCKED', `${directory} 的对比文件与附件读回字节不一致。请重新上传并下载两份 JSON。`);
    }
    assertPreviewTarget(directory, directory);
    rmSync(directory, { recursive: true });
  } catch (error) {
    if (error instanceof PreviewError || !error.code) throw error;
    throw new PreviewError('BLOCKED', `无法归档 ${directory}（${error.code}：${error.path ?? directory}）。请检查对比目录和附件路径后重试。`);
  }
  return directory;
}

function attachmentPaths(json) {
  let files;
  try {
    files = JSON.parse(json);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (!Array.isArray(files) || files.length !== 2 || !files.every(path => typeof path === 'string' && path.trim())) {
    throw new PreviewError('BLOCKED', '请提供从 Spec Issue 下载的两份 JSON 附件路径。');
  }
  return files;
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    throw new PreviewError('BLOCKED', '用法：closeout-preview.mjs <repo> <issue> <files-json>');
  }
  const [repo, issue, json] = args;
  console.log(archive({ repo, issue }, attachmentPaths(json)));
} catch (error) {
  if (!(error instanceof PreviewError)) throw error;
  console.error(`${error.code}\t${error.message}`);
  process.exitCode = 1;
}
