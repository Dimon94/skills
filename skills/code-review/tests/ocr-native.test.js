// ============================================================
// ocr-native.js 公开入口：Review 模型 → OCR 环境变量、结果判定、缺 CLI。
// 替身只在 ocr CLI 边界：一个 shell 脚本记录收到的参数与环境，按 FAKE_* 写结果。
// 期望值来源：repo://docs/adr/0023-ocr-review-specialty.md 与 SKILL.md「OCR 专项」节。
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '../scripts/ocr-native.js');

function fixture({ report, exit = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-native-'));
  const entry = (model, effort) => ({ agent: 'pi', model, effort });
  const roles = { review: { 'whole-change': { standards: { ...entry('gw/auto/sol', 'xhigh'), candidates: [entry('gw/kimi', 'max')] } } } };
  fs.writeFileSync(path.join(dir, 'roles.json'), JSON.stringify(roles));
  fs.writeFileSync(path.join(dir, 'pi.json'), JSON.stringify({ providers: { gw: { baseUrl: 'http://gw.test/v1', apiKey: 'SECRET-KEY' } } }));
  const write = report ? `printf '%s' '${JSON.stringify(report)}' > "$out"` : ':';
  fs.writeFileSync(path.join(dir, 'ocr'), `#!/bin/sh
[ "$1" = "--version" ] && { echo "open-code-review v9.9.9"; exit 0; }
printf '%s\\n' "$*" "$OCR_LLM_PROTOCOL" "$OCR_LLM_URL" "$OCR_LLM_MODEL" "$OCR_LLM_TOKEN" > "${dir}/call"
while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done
${write}
exit ${exit}
`, { mode: 0o755 });
  return dir;
}

function run(dir, extra = []) {
  const args = ['--commit', 'abc', '--output', path.join(dir, 'out.json'), '--roles', path.join(dir, 'roles.json'), '--pi-models', path.join(dir, 'pi.json'), '--ocr', path.join(dir, 'ocr'), ...extra];
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: res.status, out: res.stdout, result: JSON.parse(res.stdout) };
}

test('主选 Review 模型翻译成 OCR 环境变量，不用候补，凭据不进 stdout', () => {
  const dir = fixture({ report: { status: 'complete', message: 'ok', comments: [{}, {}] } });
  const { code, out, result } = run(dir);
  const [args, protocol, url, model, token] = fs.readFileSync(path.join(dir, 'call'), 'utf8').split('\n');

  assert.equal(code, 0);
  assert.deepEqual([protocol, url, model, token], ['openai', 'http://gw.test/v1', 'auto/sol', 'SECRET-KEY']);
  assert.match(args, /--commit abc .*--effort high/);
  assert.equal(result.status, 'ran');
  assert.equal(result.comments, 2);
  assert.doesNotMatch(out, /SECRET-KEY/);
});

test('OCR 报告不是 complete 时判 failed，不当作通过', () => {
  const dir = fixture({ report: { status: 'failed', comments: null } });
  const { code, result } = run(dir);

  assert.equal(code, 1);
  assert.equal(result.status, 'failed');
});

test('OCR 退出 0 但没写结果时，旧结果文件不能冒充本次结果', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'out.json'), JSON.stringify({ status: 'complete', comments: [] }));
  const { code, result } = run(dir);

  assert.equal(code, 1);
  assert.equal(result.status, 'failed');
});

test('ocr 不在 PATH 时判 skipped，不读模型配置', () => {
  const dir = fixture();
  const { code, result } = run(dir, ['--ocr', path.join(dir, 'missing-ocr'), '--roles', path.join(dir, 'absent.json')]);

  assert.equal(code, 3);
  assert.equal(result.status, 'skipped');
});
