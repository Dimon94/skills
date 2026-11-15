#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/formal-verify-delivery-cycle/scripts/mutants.js
//   INPUT: repo://skills/delivery-cycle/scripts/delivery-cycle.js（就地写入 scratch 错误变体，结束必还原）
//   OUTPUT: 每个变体：verify.js 是否报出预期性质；还原后 sha256 与原文件一致；退出码 0 = 全部被捕获且已还原
//   POS: 证明检查能失败；不是产品测试，不改模型
//   TEST: 自身即证明；还原失败时退出码 2 并打印原文件 sha256
// L6
//   RESTORE: finally 写回原字节并比对 sha256；SIGINT／SIGTERM 同样先还原
//   PRECOND: delivery-cycle.js 无未提交改动（否则拒绝运行，避免覆盖他人工作）
// ==========================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TARGET = fileURLToPath(new URL('../../delivery-cycle/scripts/delivery-cycle.js', import.meta.url));
const VERIFY = fileURLToPath(new URL('./verify.js', import.meta.url));

// 每个变体：破坏的代码点、替换、预期被哪条性质捕获
const MUTANTS = Object.freeze([
  { name: 'drop-observed-expiry', expect: 'R8', from: 'function scheduledLater(target, issue, { plan }, run) {',
    to: 'function scheduledLater(target, issue, { plan }, run) {\n  return false;' },
  { name: 'drop-clock-check', expect: 'R8', from: 'function ensureClock({ now }, run) {',
    to: 'function ensureClock({ now }, run) {\n  return;' },
  { name: 'skip-pre-read', expect: 'R9', from: '  const before = await preRead(target, deps, run);',
    to: '  const before = deps.plan.planned.get(target.issueId);' },
  { name: 'send-when-conforming', expect: 'R9', from: "  if (!Object.keys(patch).length) return record(run, target, 'unchanged') ?? before;\n",
    to: '' },
  { name: 'trust-claim-without-readback', expect: 'R9V', from: 'function classifyReadback(claim, after, remaining, action) {',
    to: "function classifyReadback(claim, after, remaining, action) {\n  if (claim === 'accepted') return ['verified'];" },
  { name: 'count-unchanged-as-changed', expect: 'R11', from: "  if (write === 'verified') run.changed += 1;",
    to: "  if (write === 'verified' || write === 'unchanged') run.changed += 1;" },
  { name: 'partial-as-synchronized', expect: 'R9S', from: "  else if (conforming > 0) status = 'partial';",
    to: "  else if (conforming > 0) status = 'synchronized';" }
]);

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const original = readFileSync(TARGET);
const originalSha = sha(original);

function restore() {
  writeFileSync(TARGET, original);
  return sha(readFileSync(TARGET)) === originalSha;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { restore(); process.exit(130); });

function refuseDirty() {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', TARGET], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`${TARGET} 有未提交改动，拒绝写 scratch 变体`);
}

function runMutant({ name, expect, from, to }) {
  const text = original.toString('utf8');
  if (text.split(from).length !== 2) return { name, caught: false, why: '变体锚点不唯一或已不存在：需更新 mutants.js' };
  writeFileSync(TARGET, text.replace(from, to));
  const out = spawnSync(process.execPath, [VERIFY], { encoding: 'utf8' });
  const hit = out.status === 1 && out.stdout.includes(`VIOLATION ${expect} `);
  const line = out.stdout.split('\n').find((l) => l.startsWith('VIOLATION')) ?? out.stderr.split('\n')[0];
  return { name, caught: hit, why: line };
}

refuseDirty();
console.log(`original sha256=${originalSha}`);
let ok = true;
try {
  for (const mutant of MUTANTS) {
    const r = runMutant(mutant);
    ok &&= r.caught;
    console.log(`${r.caught ? 'CAUGHT' : 'MISSED'} ${r.name} (expect ${mutant.expect}): ${r.why}`);
  }
} finally {
  const same = restore();
  console.log(`restored sha256=${sha(readFileSync(TARGET))} identical=${same}`);
  if (!same) process.exit(2);
}
console.log(ok ? 'MUTANTS: ALL CAUGHT' : 'MUTANTS: SOME MISSED');
process.exitCode = ok ? 0 : 1;
