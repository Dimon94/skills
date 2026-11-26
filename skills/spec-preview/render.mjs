// ==========================================================================
// L4: build、delta、compare 和 restore 共用 smyw 渲染。成功后返回 preview.html 绝对路径。
// L5: source 为已核验的 spec.json 路径，html 为其同目录的 preview.html。
//     smyw 最多运行 10 秒。超时、构建失败或未产出 HTML 均报 BLOCKED。
// ==========================================================================
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { PreviewError } from './preview-error.mjs';
import { smywScripts } from './smyw.mjs';

const renderTimeoutMs = 10_000;

function render(source) {
  const { build: renderer } = smywScripts();
  const result = spawnSync(process.execPath, [renderer, source], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: renderTimeoutMs, killSignal: 'SIGKILL',
  });
  if (result.error?.code === 'ETIMEDOUT') {
    throw new PreviewError('BLOCKED', `smyw 构建在 ${renderTimeoutMs / 1_000} 秒后超时：${source}。请检查预览目录和版本归档后重试。`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || result.signal;
    throw new PreviewError('BLOCKED', `smyw 构建失败：${source}\n${detail}`);
  }
}

export function renderPreview(source, html) {
  render(source);
  if (!statSync(html, { throwIfNoEntry: false })?.isFile()) {
    throw new PreviewError('BLOCKED', `smyw 未生成 ${html}。请核对 SMYW_DIR 后重试。`);
  }
  return html;
}
