// ==========================================================================
// L4: 只写 compare/。锁定版按字节复制，审查结论保留原意并跳过 CopyLint。
// L5: 页面和节点需截图，步骤和后端需代码坐标。计划外项至少提供一种证据。
// L6: 核验锁和逐项证据后，在隔离目录渲染，仅让 smyw 读取本次对比的两个版本。
// TEST: skills/spec-preview/tests/scenarios.test.mjs 的 S7
// ==========================================================================
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEvidence } from '../feedback.mjs';
import { changeItems } from '../lib/change-items.cjs';
import { assertPreviewTarget, previewDirectory } from '../preview-dir.mjs';
import { PreviewError } from '../preview-error.mjs';
import { renderPreview } from '../render.mjs';

const labels = new Map([
  ['match', '一致'], ['deviation', '偏差'], ['missing', '缺失'], ['extra', '计划外'],
]);
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const hasCode = value => Array.isArray(value) && value.length > 0 && value.every(nonempty);

function parseSpec(bytes, path) {
  let spec;
  try {
    spec = JSON.parse(bytes);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new PreviewError('BLOCKED', `无法解析 ${path}：${error.message}。请修正 JSON 后重试。`);
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new PreviewError('BLOCKED', `${path} 的顶层须为 JSON 对象。请修正后重试。`);
  }
  return spec;
}

function readLocked(directory, lock, archive) {
  const path = join(directory, archive);
  assertPreviewTarget(path, directory);
  const bytes = readEvidence(path, '请先构建并确认 Spec 预览。');
  if (createHash('sha256').update(bytes).digest('hex') !== lock.sha256) {
    throw new PreviewError('PreviewLockMismatch', `${path} 的 SHA-256 与锁定行不一致。请核对 Spec 锁定行。`);
  }
  const spec = parseSpec(bytes, path);
  if (spec.version !== lock.version) {
    throw new PreviewError('PreviewLockMismatch', `${path} 的版本与锁定行不一致。请核对 Spec 锁定行。`);
  }
  return { bytes, spec };
}

function indexVerdicts(items, verdicts) {
  const known = new Set(items.map(({ id }) => id));
  const byId = new Map();
  for (const [index, entry] of verdicts.entries()) {
    const { id, verdict } = entry ?? {};
    const validId = known.has(id) ? verdict !== 'extra' : typeof id === 'string' && /^extra:\S+$/.test(id) && verdict === 'extra';
    if (!labels.has(verdict) || !validId || byId.has(id)) {
      throw new PreviewError('BLOCKED', `结论 verdicts[${index}] 的 id 或结论无效，或 id 重复。请核对改动项与逐项结论。`);
    }
    byId.set(id, entry);
  }
  return byId;
}

function assertEvidence(items, byId) {
  const missing = [];
  for (const { id, kind } of items) {
    const verdict = byId.get(id);
    const evidence = verdict?.evidence;
    const needsScreenshot = kind === 'page' || kind === 'node';
    if (!verdict) missing.push(`${id}.verdict`);
    else if (needsScreenshot && !nonempty(evidence?.screenshot)) missing.push(`${id}.screenshot`);
    else if (!needsScreenshot && !hasCode(evidence?.code)) missing.push(`${id}.code`);
  }
  for (const { id, verdict, evidence } of byId.values()) {
    if (verdict === 'extra' && !nonempty(evidence?.screenshot) && !hasCode(evidence?.code)) missing.push(`${id}.evidence`);
  }
  if (missing.length) throw new PreviewError('MissingEvidence', `请补齐对比页的逐项结论与证据。\n${missing.join('\n')}`);
}

function collectIds(value, ids) {
  if (!value || typeof value !== 'object') return;
  if (value.id != null) ids.add(String(value.id).trim());
  for (const child of Object.values(value)) collectIds(child, ids);
}

function verdictFlow(locked, built, verdicts) {
  const ids = new Set();
  collectIds(locked, ids);
  collectIds(built, ids);
  const nextId = base => {
    let id = base;
    for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
    ids.add(id);
    return id;
  };
  return {
    id: nextId('compare-verdicts'), name: '对比结论',
    steps: verdicts.map((entry, index) => ({
      id: nextId(`compare-verdict-${index + 1}`), actor: 'system', text: verdictText(entry),
    })),
  };
}

function verdictText({ id, verdict, evidence, accepted }) {
  const lines = [`${id} · ${labels.get(verdict)}`];
  if (nonempty(evidence.screenshot)) lines.push(evidence.screenshot);
  if (hasCode(evidence.code)) lines.push(...evidence.code);
  if (nonempty(accepted)) lines.push(`已接受 · ${accepted}`);
  return lines.join('\n');
}

function renderCompare(parent, archive, frozen, spec) {
  const directory = join(parent, 'compare');
  const files = [archive, 'spec.json', 'preview.html'];
  const verifyTargets = () => {
    assertPreviewTarget(directory, parent);
    if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new PreviewError('BLOCKED', `${directory} 是符号链接。请改用独立的对比目录。`);
    }
    for (const file of files) assertPreviewTarget(join(directory, file), directory);
  };
  verifyTargets();
  mkdirSync(directory, { recursive: true });
  const staging = mkdtempSync(join(directory, '.render-'));
  try {
    const source = join(staging, 'spec.json');
    writeFileSync(join(staging, archive), frozen);
    writeFileSync(source, JSON.stringify(spec, null, 2));
    renderPreview(source, join(staging, 'preview.html'));
    for (const file of files) renameSync(join(staging, file), join(directory, file));
    verifyTargets();
    return join(directory, 'preview.html');
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function compare(ref, lock, asBuilt, verdicts) {
  const directory = previewDirectory(ref);
  const archive = `spec-v${lock.version}.json`;
  const { bytes, spec: locked } = readLocked(directory, lock, archive);
  const built = parseSpec(readEvidence(asBuilt, '请提供实现版 JSON。'), asBuilt);
  if (built.flows !== undefined && !Array.isArray(built.flows)) {
    throw new PreviewError('BLOCKED', `${asBuilt} 的 flows 须为数组。请修正后重试。`);
  }
  const items = changeItems(locked);
  const byId = indexVerdicts(items, verdicts);
  assertEvidence(items, byId);
  const flow = verdictFlow(locked, built, [...byId.values()]);
  const spec = { ...built, stage: 'done', version: lock.version + 1, flows: [...(built.flows ?? []), flow] };
  try {
    return renderCompare(directory, archive, bytes, spec);
  } catch (error) {
    if (error instanceof PreviewError || !error.code) throw error;
    throw new PreviewError('BLOCKED', `无法写入 ${join(directory, 'compare')}（${error.code}）。请核对缓存目录后重试。`);
  }
}
