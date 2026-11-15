/**
 * MCP 通道：经公开 CLI main() 驱动，callTool 是外部边界替身（形状取自 2026-11-15 官方 Linear MCP live 响应）。
 * 期望值来源：m00508 任务合同（缺字段 → unverifiable 点名、14 天单列 mismatch、只在工具拒权时 permission_denied）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../scripts/run.js';
import { createMcporterCaller, createLinearMcpAdapter } from '../scripts/linear-mcp.js';

const TEAM = '5c8b86a4-c5c1-4d96-9821-a2d6fab1a56a';
const ARGV = ['--team', TEAM, '--project', 'p-1', '--exclusion-label', 'lab-x'];
const NOW = () => new Date('2026-11-17T10:00:00Z');
const BASIC_TEAM = { id: TEAM, key: 'DD', name: 'Dawn', displayName: 'Dawn' };
const BIWEEKLY = [
  { id: 'c-a', number: 1, startsAt: '2026-11-15T16:00:00.000Z', endsAt: '2026-11-29T16:00:00.000Z', isCurrent: false },
  { id: 'c-b', number: 2, startsAt: '2026-11-29T16:00:00.000Z', endsAt: '2026-12-13T16:00:00.000Z', isCurrent: false }
];

function tools(overrides = {}) {
  const calls = [];
  const table = { get_team: () => BASIC_TEAM, list_cycles: () => BIWEEKLY, ...overrides };
  const callTool = async (tool, args) => {
    calls.push({ tool, args });
    if (!table[tool]) throw new Error(`unexpected tool ${tool}`);
    return table[tool](args);
  };
  return { calls, callTool };
}

async function cli(argv, deps) {
  const out = [];
  const keychain = [];
  const code = await main(argv, { stdout: (s) => out.push(s), stderr: () => {}, now: NOW,
    request: async () => { keychain.push(1); return { errors: [{ message: 'Invalid scope: read required' }] }; }, ...deps });
  return { code, result: out[0] && JSON.parse(out[0]), keychain };
}

test('默认通道是 MCP：旧 Key 拒绝不参与，缺配置字段报 unverifiable 点名，14 天另列 mismatch，零写入', async () => {
  const { calls, callTool } = tools();
  const { code, result, keychain } = await cli(ARGV, { callTool });

  assert.equal(code, 1);
  assert.equal(keychain.length, 0);
  assert.deepEqual(result.problems.map((p) => p.code), ['configuration_unverifiable', 'configuration_mismatch']);
  assert.ok(!result.problems.some((p) => p.code === 'permission_denied'));
  assert.match(result.problems[0].message, /timezone.*cycleDurationWeeks/);
  assert.match(result.problems[1].message, /c-a（14 天）, c-b（14 天）/);
  assert.ok(!calls.some((c) => c.tool === 'save_issue'));
});

test('只有工具明确拒权才是 permission_denied；其他工具错误是 capability_unavailable', async () => {
  const cases = [['Error: Forbidden: permission denied for team', 'permission_denied'], ['Error: Could not find team', 'capability_unavailable']];
  for (const [text, code] of cases) {
    const execFile = async () => { throw Object.assign(new Error('exit 1'), { stdout: JSON.stringify({ isError: true, content: [{ type: 'text', text }] }) }); };
    const { result } = await cli(ARGV, { callTool: createMcporterCaller({ execFile }) });
    assert.deepEqual(result.problems.map((p) => p.code), [code]);
  }
});

test('--transport graphql 才走 Key 通道', async () => {
  const { calls, callTool } = tools();
  const { result, keychain } = await cli([...ARGV, '--transport', 'graphql'], { callTool });
  assert.ok(keychain.length > 0);
  assert.equal(calls.length, 0);
  assert.equal(result.problems[0].code, 'permission_denied');
});

test('Issue 映射：分页、完整描述判 Spec、标签名映射 ID；patch 总带 id 且只传增量', async () => {
  const SPEC = ['Problem Statement', 'Solution', 'User Stories', 'Implementation Decisions', 'Testing Decisions', 'Out of Scope']
    .map((h) => `## ${h}\n\nx`).join('\n\n');
  const issues = {
    'DD-1': { id: 'DD-1', statusType: 'started', labels: ['Feature'], parentId: null, cycleId: null, teamId: TEAM, projectId: 'p-1', description: SPEC },
    'DD-2': { id: 'DD-2', statusType: 'started', labels: ['排除'], parentId: 'DD-1', cycleId: 'c-a', teamId: TEAM, projectId: 'p-1', description: '## Parent\n\nDD-1' }
  };
  const { calls, callTool } = tools({
    list_issues: ({ cursor }) => (cursor ? { issues: [{ id: 'DD-2' }], hasNextPage: false } : { issues: [{ id: 'DD-1' }], hasNextPage: true, cursor: 'u1' }),
    get_issue: ({ id }) => issues[id],
    list_issue_labels: () => ({ labels: [{ id: 'lab-f', name: 'Feature' }, { id: 'lab-x', name: '排除' }], hasNextPage: false }),
    save_issue: () => ({ id: 'DD-2' })
  });
  const linear = createLinearMcpAdapter({ callTool, teamId: TEAM });
  const first = await linear.listIssues({ teamId: TEAM, projectId: 'p-1' }, null);
  const second = await linear.listIssues({ teamId: TEAM, projectId: 'p-1' }, first.pageInfo.endCursor);

  assert.equal(first.nodes[0].specRef, 'DD-1');
  const { description, ...rest } = issues['DD-2'];
  assert.deepEqual(second.nodes[0], { ...rest, labels: ['lab-x'], specRef: null });
  assert.deepEqual(await linear.readLabel('lab-x'), { id: 'lab-x', teamId: TEAM });
  assert.equal(await linear.readLabel('lab-missing'), null);
  assert.deepEqual(await linear.patchIssue('DD-2', { cycle: null, removeLabels: ['lab-x'] }), { success: true });
  assert.deepEqual(calls.at(-1), { tool: 'save_issue', args: { id: 'DD-2', cycle: null, removeLabels: ['lab-x'] } });
});
