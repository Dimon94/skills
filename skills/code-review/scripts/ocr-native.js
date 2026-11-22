#!/usr/bin/env node
// ============================================================
// L3 文件合同
// COORD: skills/code-review/scripts/ocr-native.js
// INPUT: ~/.config/delivery-pipeline/model-roles.json 的 review.whole-change.standards；
//        ~/.pi/agent/models.json 的 provider baseUrl/apiKey；PATH 上的 ocr CLI。
// OUTPUT: stdout 一行 JSON 结果；--output 指定路径写 OCR 原始 JSON。
// POS: 只把 Review 模型翻译成 OCR 环境变量并跑一次 native review。
//      不定级、不判 verdict、不选模型；定级归 repo://skills/code-review/SKILL.md。
// TEST: node --test skills/code-review/tests/ocr-native.test.js
// PROTOCOL: 改参数或结果字段时同步 SKILL.md「OCR 专项」节与 ADR 0023。
// ============================================================
// L4 main 合同
// IN: --output <file>；--from <ref> 与 --commit <sha> 至多一个，都缺省时审工作区。
// OUT: {status:"ran"|"skipped"|"failed", reason, model, ocrVersion, comments, output}。
//      退出码 ran=0，skipped=3，failed=1，参数错误=2。
// INVARIANT: 只用配置里的主选模型，不读 candidates，不静默换模型；凭据不进 stdout。
// FAIL: OCR 退出非 0 或 JSON status 不是 complete 时为 failed；ocr 不在 PATH 为 skipped。
// ============================================================
// L5 参数合同
// PARAM: --roles 默认 ~/.config/delivery-pipeline/model-roles.json；
//        --pi-models 默认 ~/.pi/agent/models.json；--ocr 默认 PATH 上的 ocr。
// PAIR: model 形如 <pi provider>/<gateway model>；provider 必须在 pi models.json。
//       effort low/medium 原样传给 ocr --effort，其余档位传 high。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const EXIT = { ran: 0, failed: 1, usage: 2, skipped: 3 };

function parseArgs(argv) {
  const home = os.homedir();
  const opts = {
    roles: path.join(home, '.config/delivery-pipeline/model-roles.json'),
    piModels: path.join(home, '.pi/agent/models.json'),
    ocr: 'ocr',
  };
  const keys = { '--from': 'from', '--commit': 'commit', '--output': 'output', '--roles': 'roles', '--pi-models': 'piModels', '--ocr': 'ocr' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys[argv[i]];
    if (!key || argv[i + 1] === undefined) throw new Error(`unknown or incomplete argument: ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  if (!opts.output || (opts.from && opts.commit)) {
    throw new Error('usage: ocr-native.js [--from <ref> | --commit <sha>] --output <file>');
  }
  return opts;
}

function resolveEndpoint(opts) {
  const entry = JSON.parse(fs.readFileSync(opts.roles, 'utf8')).review?.['whole-change']?.standards;
  if (entry?.agent !== 'pi') throw new Error(`unsupported review agent: ${entry?.agent}`);
  const [provider, ...rest] = String(entry.model).split('/');
  const conf = JSON.parse(fs.readFileSync(opts.piModels, 'utf8')).providers?.[provider];
  if (!conf?.baseUrl || rest.length === 0) throw new Error(`pi provider not resolvable: ${provider}`);
  return { url: conf.baseUrl, token: conf.apiKey || '', model: rest.join('/'), effort: ['low', 'medium'].includes(entry.effort) ? entry.effort : 'high' };
}

function ocrArgs(opts, ep) {
  const range = opts.from ? ['--from', opts.from] : opts.commit ? ['--commit', opts.commit] : [];
  return ['review', ...range, '--format', 'json', '--audience', 'agent', '--effort', ep.effort, '--output', opts.output];
}

function run(opts) {
  const version = spawnSync(opts.ocr, ['--version'], { encoding: 'utf8' });
  if (version.error) return { status: 'skipped', reason: 'ocr not installed' };
  const ep = resolveEndpoint(opts);
  fs.rmSync(opts.output, { force: true });
  const env = { ...process.env, OCR_LLM_PROTOCOL: 'openai', OCR_LLM_URL: ep.url, OCR_LLM_TOKEN: ep.token, OCR_LLM_MODEL: ep.model };
  const child = spawnSync(opts.ocr, ocrArgs(opts, ep), { encoding: 'utf8', env, stdio: ['ignore', 'ignore', 'pipe'] });
  const base = { model: ep.model, ocrVersion: version.stdout.split('\n')[0], output: opts.output };
  const report = fs.existsSync(opts.output) ? JSON.parse(fs.readFileSync(opts.output, 'utf8')) : {};
  if (child.status !== 0 || report.status !== 'complete') {
    return { ...base, status: 'failed', reason: `ocr exit ${child.status}, status ${report.status}: ${(child.stderr || '').trim().split('\n').pop()}` };
  }
  return { ...base, status: 'ran', reason: report.message, comments: (report.comments || []).length };
}

function main(argv) {
  let result;
  try {
    result = run(parseArgs(argv));
  } catch (error) {
    const usage = error.message.startsWith('usage') || error.message.startsWith('unknown');
    process.stdout.write(`${JSON.stringify({ status: 'failed', reason: error.message })}\n`);
    return usage ? EXIT.usage : EXIT.failed;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return EXIT[result.status];
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
