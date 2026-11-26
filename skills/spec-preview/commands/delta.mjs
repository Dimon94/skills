// ==========================================================================
// L4: 无锁定预览时，在缓存中生成 stage: done 的 v1。证据沿用原文，跳过 CopyLint。
// L5: 改动项 id 唯一。页面与节点双侧需截图，步骤与后端双侧需代码坐标。
//     任一侧提供检查输出时，两侧均需提供。MissingEvidence 逐行列出缺项。
// L6: 校验证据 → 排除已有 Spec 预览 → 核验目标 → 写入并渲染 → 核验产物。
//     同一 ref 可重跑并更新变更预览。实际锁定行由调用方按预览门判断。
// ==========================================================================
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPreviewTarget, previewDirectory } from '../preview-dir.mjs';
import { PreviewError } from '../preview-error.mjs';
import { renderPreview } from '../render.mjs';

const kinds = new Set(['page', 'node', 'step', 'backend']);
const changes = new Set(['added', 'removed', 'modified']);
const sides = ['before', 'after'];
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const hasScreenshot = kind => kind === 'page' || kind === 'node';

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PreviewError('BLOCKED', '请提供至少一个改动项。');
  }
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    if (!nonempty(item?.id) || !kinds.has(item.kind) || !changes.has(item.change)) {
      throw new PreviewError('BLOCKED', `改动项 items[${index}] 需要非空 id、有效 kind 和 change。`);
    }
    const id = item.id.trim();
    if (ids.has(id)) throw new PreviewError('BLOCKED', `改动项 id 重复：${id}。`);
    ids.add(id);
  }
  const missing = items.flatMap(missingEvidence);
  if (missing.length) {
    throw new PreviewError('MissingEvidence', `请补齐改前和改后证据。\n${missing.join('\n')}`);
  }
  return ids;
}

function missingEvidence({ id, kind, before, after }) {
  const required = hasScreenshot(kind) ? 'screenshot' : 'code';
  const valid = required === 'screenshot' ? nonempty : value =>
    Array.isArray(value) && value.length > 0 && value.every(nonempty);
  const checkRequired = before?.check !== undefined || after?.check !== undefined;
  const evidence = { before, after };
  const missing = [];
  for (const side of sides) {
    if (!valid(evidence[side]?.[required])) missing.push(`${id}.${side}.${required}`);
    if (checkRequired && !nonempty(evidence[side]?.check)) missing.push(`${id}.${side}.check`);
  }
  return missing;
}

function isDeltaVersion(path) {
  try {
    const spec = JSON.parse(readFileSync(path, 'utf8'));
    return spec?.stage === 'done' && spec.version === 1;
  } catch (error) {
    throw new PreviewError('BLOCKED', `无法核验预览文件 ${path}：${error.message}。请核对预览目录。`);
  }
}

function assertDeltaDirectory(directory) {
  if (!existsSync(directory)) return;
  const entries = readdirSync(directory);
  const isSpecPreview = entries.some(name => {
    if (/^feedback-v\d+\.(?:json|md)$/.test(name)) return true;
    const archive = /^spec-v(\d+)\.json$/.exec(name);
    if (archive && archive[1] !== '1') return true;
    if (name !== 'spec.json' && !archive) return false;
    return !isDeltaVersion(join(directory, name));
  });
  if (isSpecPreview) {
    throw new PreviewError('BLOCKED', `已有 Spec 预览：${directory}。请走对比页。`);
  }
}

function evidenceText(kind, { screenshot, code, check }) {
  const primary = hasScreenshot(kind) ? screenshot : code.join('\n');
  return check === undefined ? primary : `${primary}\n${check}`;
}

function evidenceFields({ kind, before, after }, field) {
  return { [field]: evidenceText(kind, after), before: { [field]: evidenceText(kind, before) } };
}

function extraIds(ids) {
  let serial = 0;
  return () => {
    let id;
    do { id = `delta-group-${++serial}`; } while (ids.has(id));
    return id;
  };
}

function deltaPage(item, nextId) {
  const { id, kind, change } = item;
  const image = { type: 'image', ...evidenceFields(item, 'label') };
  const unit = kind === 'page'
    ? { id, change, ...evidenceFields(item, 'name') }
    : { id: nextId(), name: id };
  const child = kind === 'page' ? { id: nextId(), ...image } : { id, change, ...image };
  return { ...unit, root: { id: nextId(), type: 'page', children: [child] } };
}

function deltaSpec(ref, items, nextId) {
  const spec = { title: `${ref.repo} · ${ref.issue}`, stage: 'done', version: 1, pages: [], flows: [], backend: [] };
  const steps = [];
  const backendItems = [];
  const context = [];
  for (const item of items) {
    const { id, kind, change } = item;
    if (hasScreenshot(kind)) spec.pages.push(deltaPage(item, nextId));
    if (kind === 'step') steps.push({ id, change, actor: 'system', ...evidenceFields(item, 'text') });
    if (kind === 'backend') backendItems.push({ id, change, kind: 'field', name: id, ...evidenceFields(item, 'note') });
    // smyw 隐藏增删项缺席的一侧。用未标记的步骤保留两侧证据。
    if (change !== 'modified') context.push(deltaContext(item, nextId()));
  }
  if (steps.length) spec.flows.push({ id: nextId(), name: '流程证据', steps });
  if (context.length) spec.flows.push({ id: nextId(), name: '增删项证据', steps: context });
  if (backendItems.length) spec.backend.push({ id: nextId(), kind: 'service', name: '后端证据', items: backendItems });
  return spec;
}

function deltaContext(item, id) {
  const { id: itemId, kind, before, after } = item;
  return {
    id, actor: 'system',
    text: `${itemId}\n${evidenceText(kind, after)}`,
    before: { text: `${itemId}\n${evidenceText(kind, before)}` },
  };
}

export function delta(ref, items) {
  const ids = validateItems(items);
  const directory = previewDirectory(ref);
  const source = join(directory, 'spec.json');
  const archive = join(directory, 'spec-v1.json');
  const html = join(directory, 'preview.html');
  const targets = [source, archive, html];
  for (const target of targets) assertPreviewTarget(target, directory);
  assertDeltaDirectory(directory);

  const spec = JSON.stringify(deltaSpec(ref, items, extraIds(ids)), null, 2) + '\n';
  mkdirSync(directory, { recursive: true });
  writeFileSync(source, spec);
  renderPreview(source, html);
  for (const target of targets) assertPreviewTarget(target, directory);
  if (!existsSync(archive) || readFileSync(archive, 'utf8') !== spec) {
    throw new PreviewError('BLOCKED', `smyw 未写入本轮归档 ${archive}。请核对归档后重试。`);
  }
  return html;
}
