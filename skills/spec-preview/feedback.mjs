// L3: build、apply 与 confirm 共用正安全整数版本的校验规则。
// L5: 确认依据来自 smyw 导出的当前版本反馈头与批注节。
import { readFileSync } from 'node:fs';
import { PreviewError } from './preview-error.mjs';

export function readEvidence(path, recovery) {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new PreviewError('MissingEvidence', `无法读取 ${path}（${error.code}）。${recovery}`);
  }
}

export function readVersion(source) {
  const bytes = readEvidence(source, '请先生成 Spec 预览。');
  let spec;
  try {
    spec = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new PreviewError('BLOCKED', `无法解析 ${source}：${error.message}。请修正 spec.json 后重试。`);
  }
  return requireSpecVersion(spec, source);
}

export function requireSpecVersion(spec, source) {
  if (!Number.isSafeInteger(spec?.version) || spec.version < 1) {
    throw new PreviewError('BLOCKED', `${source} 缺少正整数版本。请修正 spec.json 后重试。`);
  }
  return spec.version;
}

export function assertFeedbackConfirmed(path, version) {
  const markdown = readEvidence(path, '请重新导出 smyw 反馈。').toString('utf8');
  const [header, ...sections] = markdown.split(/^##[ \t]+/m);
  if (!/^\*\*✅ 用户已确认方案/m.test(header)) {
    throw new PreviewError('NotConfirmed', `${path} 缺少用户确认标记。请在预览中确认方案并重新导出反馈。`);
  }
  const basedOn = /^>[ \t]+基于方案 v([1-9]\d*)(?=[ \t(（]|\r?$)/m.exec(header)?.[1];
  if (Number(basedOn) !== version) {
    throw new PreviewError('NotConfirmed', `${path} 的反馈未绑定当前方案 v${version}。请在该版本确认并重新导出反馈。`);
  }
  const comments = sections.find(section => /^批注[ \t]*\r?\n/.test(section));
  if (/^\d+\.[ \t]+\*\*\[必须改\]/m.test(comments ?? '')) {
    throw new PreviewError('NotConfirmed', `${path} 仍有 v${version} 的「必须改」。请落实批注并呈现新版本。`);
  }
}
