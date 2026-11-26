// ==========================================================================
// L3: init、build 共用同一套预览写入路径。
// L4: 检查真实目标，包括经由链接落入 Git 仓库的目标。
// L5: 绝对 XDG_CACHE_HOME 优先。缺省使用 ~/.cache。
// ==========================================================================
import { spawnSync } from 'node:child_process';
import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PreviewError } from './preview-error.mjs';

function realTarget(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const parent = realTarget(dirname(path));
  const target = join(parent, basename(path));
  if (!lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) return target;
  return realTarget(resolve(parent, readlinkSync(target)));
}

function existingDirectory(path) {
  if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) return path;
  return existingDirectory(dirname(path));
}

function assertOutsideGit(target) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = spawnSync('git', ['-C', existingDirectory(target), 'rev-parse', '--git-dir'], {
    env: { ...env, LC_ALL: 'C' }, encoding: 'utf8',
  });
  if (git.status === 0 || git.stderr?.includes('detected dubious ownership')) {
    throw new PreviewError('InsideRepo', `预览目标位于 Git 仓库内：${target}。请使用仓库外的缓存目录。`);
  }
  if (git.status !== 128 || !git.stderr.includes('not a git repository')) {
    throw new PreviewError('BLOCKED', `无法核验预览目标 ${target} 的 Git 边界：${git.error?.message || git.stderr?.trim()}`);
  }
}

export function assertPreviewTarget(target, base) {
  const actual = realTarget(target);
  assertOutsideGit(actual);
  const offset = relative(realTarget(base), actual);
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new PreviewError('BLOCKED', `预览目标 ${target} 指向缓存目录之外：${actual}。请修正路径。`);
  }
}

export function previewDirectory({ repo, issue }) {
  const xdgCache = process.env.XDG_CACHE_HOME || '';
  const cache = isAbsolute(xdgCache) ? xdgCache : join(homedir(), '.cache');
  const directory = resolve(cache, 'dverity', 'spec-preview', repo, issue);
  assertPreviewTarget(directory, cache);
  return directory;
}
