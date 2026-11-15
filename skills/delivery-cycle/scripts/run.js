#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/delivery-cycle/scripts/run.js
//   INPUT: argv：--team <uuid> --project <uuid> --exclusion-label <uuid>
//          [--exclude id,..] [--restore id,..] [--transport mcp|graphql]
//          [--spec-acceptance <SpecIdentifier>=<commentId>:<verified|not_met>（可重复或逗号分隔）]
//   OUTPUT: stdout 一行 MaintenanceResult JSON；退出码 0 = synchronized，1 = 其余结果，2 = 参数错误
//   POS: delivery-cycle 的 CLI 公开入口；只装配真实 Adapter 并调用 maintainCurrentWeek，不做判断
//   TEST: node --test skills/delivery-cycle/tests/cli.test.js
//   PROTOCOL: 参数或退出码变化时同步 repo://skills/delivery-cycle/SKILL.md「入口」
// L5
//   PARAM: --transport 缺省 mcp：经 mcporter 调本机 magpie hub 上已授权的官方 Linear MCP，不读钥匙串、不要 API Key；
//          graphql 是可选通道：macOS 钥匙串 Personal API Key 直连 GraphQL（需 read+write scope）
//   PARAM: main(argv, deps)；deps 可注入 callTool（mcp）、request（graphql）、github、now、stdout、stderr
//   PARAM: mcp 通道的 Issue id 是 identifier（DD-541）；graphql 通道是 UUID。--exclude／--restore 用所选通道的 id
//   PARAM: --spec-acceptance 是 agent 读原验收评论后的判断快照；格式错误 = 退出码 2，零请求；
//          同一 Spec 重复给出时以最后一个为准
// ==========================================================================

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { maintainCurrentWeek } from './delivery-cycle.js';
import { createEvidenceAdapter, graphqlSource } from './evidence.js';
import { createKeychainTransport, createLinearAdapter } from './linear-graphql.js';
import { createLinearMcpAdapter, createMcpEvidenceSource, createMcporterCaller } from './linear-mcp.js';

const OPTIONS = Object.freeze({
  team: { type: 'string' },
  project: { type: 'string' },
  'exclusion-label': { type: 'string' },
  exclude: { type: 'string', default: '' },
  restore: { type: 'string', default: '' },
  'spec-acceptance': { type: 'string', multiple: true, default: [] },
  transport: { type: 'string', default: 'mcp' }
});
const TRANSPORTS = Object.freeze({ mcp: mcpPorts, graphql: graphqlPorts });
const REQUIRED = Object.freeze(['team', 'project', 'exclusion-label']);
const USAGE = 'usage: run.js --team <uuid> --project <uuid> --exclusion-label <uuid> [--exclude id,..] [--restore id,..]'
  + ' [--spec-acceptance <SpecIdentifier>=<commentId>:<verified|not_met>] [--transport mcp|graphql]';

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
  if (!Object.hasOwn(TRANSPORTS, values.transport)) throw new Error(`未知 --transport：${values.transport}`);
  return { ...values, acceptance: acceptanceOf(values['spec-acceptance']) };
}

// 通道只决定 Linear 读写怎么走；判断全部归 maintainCurrentWeek
function mcpPorts(deps, teamId) {
  const callTool = deps.callTool ?? createMcporterCaller();
  return { linear: createLinearMcpAdapter({ callTool, teamId }), source: createMcpEvidenceSource(callTool) };
}

function graphqlPorts(deps) {
  const request = deps.request ?? createKeychainTransport();
  return { linear: createLinearAdapter({ request }), source: graphqlSource(request) };
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
  const { linear, source } = TRANSPORTS[values.transport](deps, values.team);
  const evidence = createEvidenceAdapter({ source, github: deps.github, acceptance: values.acceptance });
  const result = await maintainCurrentWeek(
    {
      scope: { teamId: values.team, projectId: values.project, exclusionLabelId: values['exclusion-label'] },
      exclude: ids(values.exclude),
      restore: ids(values.restore)
    },
    { linear, evidence, now: deps.now ?? (() => new Date()) }
  );
  stdout(JSON.stringify(result));
  return result.status === 'synchronized' ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
