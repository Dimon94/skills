#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/run.js
//   INPUT: argv：--team <uuid> --project <uuid> --exclusion-label <uuid>
//          [--exclude id,..] [--restore id,..]
//          [--spec-acceptance <SpecIdentifier>=<commentId>:<verified|not_met>（可重复或逗号分隔）]
//   OUTPUT: stdout 一行 MaintenanceResult JSON；退出码 0 = synchronized，1 = 其余结果，2 = 参数错误
//   POS: delivery-cycle 的 CLI 公开入口；只装配真实 Adapter 并调用 maintainCurrentWeek，不做判断
//   TEST: node --test skills/delivery-cycle/tests/cli.test.js
//   PROTOCOL: 参数或退出码变化时同步 repo://skills/delivery-cycle/SKILL.md「入口」
// L5
//   PARAM: main(argv, deps)；deps 可注入 request、github、now、stdout、stderr，缺省用钥匙串 transport 与 gh api
//   PARAM: --spec-acceptance 是 agent 读原验收评论后的判断快照；格式错误 = 退出码 2，零请求；
//          同一 Spec 重复给出时以最后一个为准
// ==========================================================================

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { maintainCurrentWeek } from './delivery-cycle.js';
import { createEvidenceAdapter } from './evidence.js';
import { createKeychainTransport, createLinearAdapter } from './linear-graphql.js';

const OPTIONS = Object.freeze({
  team: { type: 'string' },
  project: { type: 'string' },
  'exclusion-label': { type: 'string' },
  exclude: { type: 'string', default: '' },
  restore: { type: 'string', default: '' },
  'spec-acceptance': { type: 'string', multiple: true, default: [] }
});
const REQUIRED = Object.freeze(['team', 'project', 'exclusion-label']);
const USAGE = 'usage: run.js --team <uuid> --project <uuid> --exclusion-label <uuid> [--exclude id,..] [--restore id,..]'
  + ' [--spec-acceptance <SpecIdentifier>=<commentId>:<verified|not_met>]';

const ACCEPTANCE = /^([^=\s]+)=([^:\s]+):(verified|not_met)$/;

const ids = (list) => list.split(',').map((s) => s.trim()).filter(Boolean);

// 快照 → {[specRef]: {commentId, state}}；任一项格式错误整体拒绝
function acceptanceOf(values) {
  const entries = values.flatMap(ids).map((item) => {
    const m = ACCEPTANCE.exec(item);
    if (!m) throw new Error(`--spec-acceptance 格式错误：${item}`);
    return [m[1], { commentId: m[2], state: m[3] }];
  });
  return Object.fromEntries(entries);
}

function parse(argv) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, strict: true });
  const missing = REQUIRED.filter((key) => !values[key]);
  if (missing.length) throw new Error(`缺少参数：${missing.map((k) => `--${k}`).join(' ')}`);
  return { ...values, acceptance: acceptanceOf(values['spec-acceptance']) };
}

export async function main(argv, deps = {}) {
  const { stdout = console.log, stderr = console.error } = deps;
  let values;
  try {
    values = parse(argv);
  } catch (err) {
    stderr(`${err.message}\n${USAGE}`);
    return 2;
  }
  const request = deps.request ?? createKeychainTransport();
  const evidence = createEvidenceAdapter({ request, github: deps.github, acceptance: values.acceptance });
  const result = await maintainCurrentWeek(
    {
      scope: { teamId: values.team, projectId: values.project, exclusionLabelId: values['exclusion-label'] },
      exclude: ids(values.exclude),
      restore: ids(values.restore)
    },
    { linear: createLinearAdapter({ request }), evidence, now: deps.now ?? (() => new Date()) }
  );
  stdout(JSON.stringify(result));
  return result.status === 'synchronized' ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
