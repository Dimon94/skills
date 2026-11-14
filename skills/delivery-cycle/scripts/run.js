#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/run.js
//   INPUT: argv：--team <uuid> --project <uuid> --exclusion-label <uuid>
//          [--exclude id,..] [--restore id,..] [--repo <path>（默认当前目录）]
//   OUTPUT: stdout 一行 MaintenanceResult JSON；退出码 0 = synchronized，1 = 其余结果，2 = 参数错误
//   POS: delivery-cycle 的 CLI 公开入口；只装配真实 Adapter 并调用 maintainCurrentWeek，不做判断
//   TEST: node --test skills/delivery-cycle/tests/cli.test.js
//   PROTOCOL: 参数或退出码变化时同步 repo://skills/delivery-cycle/SKILL.md「入口」
// L5
//   PARAM: main(argv, deps)；deps 可注入 request、git、now、stdout、stderr，缺省用钥匙串 transport 与本地 git
// ==========================================================================

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { maintainCurrentWeek } from './delivery-cycle.js';
import { createEvidenceAdapter, createGitAncestry } from './evidence.js';
import { createKeychainTransport, createLinearAdapter } from './linear-graphql.js';

const OPTIONS = Object.freeze({
  team: { type: 'string' },
  project: { type: 'string' },
  'exclusion-label': { type: 'string' },
  exclude: { type: 'string', default: '' },
  restore: { type: 'string', default: '' },
  repo: { type: 'string', default: '.' }
});
const REQUIRED = Object.freeze(['team', 'project', 'exclusion-label']);
const USAGE = 'usage: run.js --team <uuid> --project <uuid> --exclusion-label <uuid> [--exclude id,..] [--restore id,..] [--repo <path>]';

const ids = (list) => list.split(',').map((s) => s.trim()).filter(Boolean);

function parse(argv) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, strict: true });
  const missing = REQUIRED.filter((key) => !values[key]);
  if (missing.length) throw new Error(`缺少参数：${missing.map((k) => `--${k}`).join(' ')}`);
  return values;
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
  const git = deps.git ?? createGitAncestry(values.repo);
  const result = await maintainCurrentWeek(
    {
      scope: { teamId: values.team, projectId: values.project, exclusionLabelId: values['exclusion-label'] },
      exclude: ids(values.exclude),
      restore: ids(values.restore)
    },
    { linear: createLinearAdapter({ request }), evidence: createEvidenceAdapter({ request, git }), now: deps.now ?? (() => new Date()) }
  );
  stdout(JSON.stringify(result));
  return result.status === 'synchronized' ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
