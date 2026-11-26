// ==========================================================================
// L3
//   COORD: skills/spec-preview/spec-preview.mjs
//   POS: spec-preview 的契约脚本，解析 CLI 后调用 commands/<command>.mjs。
//   INPUT: 目标项目根目录与下列位置参数。渲染入口由 smyw.mjs 解析。
//   TEST: node skills/spec-preview/tests/check-skeleton.mjs
// L4
//   OUT: 成功退出 0，路径用绝对路径，版本用十进制，改动项用 JSON 数组。
//   FAIL: PreviewError 输出 <错误码>\t<说明> 到 stderr，退出 1。
//   INVARIANT: 合同票阶段全部命令报 BLOCKED，无文件写入。
// L5
//   PARAM: ref = <repo> <issue>；repo 是目录名，issue 是 Issue 标识或草稿 id。
//   PARAM: lock = <version> <sha256>；版本为正整数，SHA-256 为 64 位小写十六进制。
//   PARAM: feedback、as-built 为文件路径；verdicts、items、files 为 JSON 数组。
//   PARAM: SMYW_DIR 指向 smyw Skill 目录，缺省 ~/.agents/skills/smyw。
//   PARAM: Preview: v<N> sha256:<hex> 为 Spec 锁定行；票头 Preview: 列改动项 id。
//   PARAM: Issue 规模标签为 scope:bug、scope:small、scope:mmf。
// L6
//   CHAIN: 校验位置参数 → 调用唯一命令单元 → 编码返回值或报告错误。
// ==========================================================================
import { init } from './commands/init.mjs';
import { build } from './commands/build.mjs';
import { apply } from './commands/apply.mjs';
import { confirm } from './commands/confirm.mjs';
import { changes } from './commands/changes.mjs';
import { compare } from './commands/compare.mjs';
import { delta } from './commands/delta.mjs';
import { rekey } from './commands/rekey.mjs';
import { restore } from './commands/restore.mjs';
import { PreviewError } from './preview-error.mjs';

/** @typedef {{ repo: string, issue: string }} PreviewRef */
/** @typedef {{ version: number, sha256: string }} PreviewLock */
/** @typedef {{ id: string, kind: 'page' | 'node' | 'step' | 'backend', change: 'added' | 'removed' | 'modified' }} ChangeItem */
/** @typedef {{ id: string, verdict: 'match' | 'deviation' | 'missing' | 'extra', evidence: { screenshot?: string, code?: string[] }, accepted?: string }} ItemVerdict */
/** @typedef {{ id: string, kind: ChangeItem['kind'], change: ChangeItem['change'], before: DeltaEvidence, after: DeltaEvidence }} DeltaItem */
/** @typedef {{ screenshot?: string, code?: string[], check?: string }} DeltaEvidence */

const signatures = {
  init:       { run: init,    args: ['ref'],                              format: String },
  build:      { run: build,   args: ['ref'],                              format: String },
  apply:      { run: apply,   args: ['ref', 'feedback'],                  format: String },
  confirm:    { run: confirm, args: ['ref', 'feedback'],                  format: formatLock },
  changes:    { run: changes, args: ['ref', 'lock'],                      format: JSON.stringify },
  compare:    { run: compare, args: ['ref', 'lock', 'as-built', 'verdicts'], format: String },
  delta:      { run: delta,   args: ['ref', 'items'],                     format: String },
  rekey:      { run: rekey,   args: ['ref', 'ref'] },
  restore:    { run: restore, args: ['ref', 'files'],                     format: String },
};

function formatLock({ version, sha256 }) {
  return `Preview: v${version} sha256:${sha256}`;
}

function readSegment(value) {
  if (!value || /[\\/]/.test(value) || value === '.' || value === '..') {
    throw new PreviewError('BLOCKED', 'repo 与 issue 必须是单个路径段');
  }
  return value;
}

function readLock(rawVersion, sha256) {
  const version = Number(rawVersion);
  if (!/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(version) || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new PreviewError('BLOCKED', 'lock 需要正整数版本和 64 位小写 SHA-256');
  }
  return { version, sha256 };
}

function readArray(value, name) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new PreviewError('BLOCKED', `${name} 必须是 JSON 数组`);
  }
  if (!Array.isArray(parsed)) throw new PreviewError('BLOCKED', `${name} 必须是 JSON 数组`);
  return parsed;
}

const parameters = {
  ref: { words: ['repo', 'issue'], read: (repo, issue) => ({ repo: readSegment(repo), issue: readSegment(issue) }) },
  lock: { words: ['version', 'sha256'], read: readLock },
  feedback: { words: ['feedback'], read: String },
  'as-built': { words: ['as-built'], read: String },
  verdicts: { words: ['verdicts-json'], read: value => readArray(value, 'verdicts') },
  items: { words: ['items-json'], read: value => readArray(value, 'items') },
  files: { words: ['files-json'], read: value => readArray(value, 'files') },
};

function parseArgs(command, args, signature) {
  const fields = signature.args.map(name => parameters[name]);
  const words = fields.flatMap(field => field.words);
  if (args.length !== words.length || args.some(arg => !arg.trim())) {
    throw new PreviewError('BLOCKED', `用法：spec-preview.mjs ${command} ${words.map(word => `<${word}>`).join(' ')}`);
  }
  let offset = 0;
  return fields.map(({ words, read }) => {
    const raw = args.slice(offset, offset + words.length);
    offset += words.length;
    return read(...raw);
  });
}

async function main([command, ...args]) {
  if (!Object.hasOwn(signatures, command)) {
    throw new PreviewError('BLOCKED', `可用命令：${Object.keys(signatures).join('、')}`);
  }
  const signature = signatures[command];
  const result = await signature.run(...parseArgs(command, args, signature));
  if (signature.format) console.log(signature.format(result));
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof PreviewError)) throw error;
  console.error(`${error.code}\t${error.message}`);
  process.exitCode = 1;
}
