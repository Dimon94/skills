/**
 * CLI 公开入口：参数解析、依赖注入、退出码与 stdout JSON。
 * 替身只在 request（Linear transport）与 git 边界；不读真实钥匙串、不发网络请求。
 * 期望值来源：brief 第 4、6 条；Spec R1、§6 稳定结果表。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../scripts/run.js';
import { SCOPE, TUESDAY, WEEK } from './fake-adapters.js';

const ARGS = ['--team', SCOPE.teamId, '--project', SCOPE.projectId, '--exclusion-label', SCOPE.exclusionLabelId];

function io() {
  const out = [];
  const err = [];
  return { out, err, stdout: (s) => out.push(s), stderr: (s) => err.push(s) };
}

const DENIED = { data: null, errors: [{ message: 'Invalid scope: read required' }] };

test('缺必填参数：退出码 2，不调用 Linear', async () => {
  const sink = io();
  const calls = [];
  const code = await main(['--team', SCOPE.teamId], { ...sink, request: async (q) => { calls.push(q); return DENIED; } });

  assert.equal(code, 2);
  assert.deepEqual(calls, []);
  assert.match(sink.err.join('\n'), /--project/);
});

test('权限不足：stdout 为 unsynchronized + permission_denied，零 mutation，退出码 1', async () => {
  const sink = io();
  const queries = [];
  const code = await main(ARGS, { ...sink, now: TUESDAY, git: async () => true,
    request: async (query) => { queries.push(query); return DENIED; } });
  const result = JSON.parse(sink.out.join(''));

  assert.equal(code, 1);
  assert.equal(result.status, 'unsynchronized');
  assert.deepEqual(result.problems.map((p) => p.code), ['permission_denied']);
  assert.ok(queries.every((q) => !q.trimStart().startsWith('mutation')));
});

test('全部符合：stdout 为 synchronized 的 MaintenanceResult，退出码 0', async () => {
  const sink = io();
  const issue = (id) => ({ id, identifier: id, team: { id: SCOPE.teamId }, project: { id: SCOPE.projectId },
    state: { type: 'completed' }, cycle: null, parent: null,
    labels: { nodes: [], pageInfo: { hasNextPage: false } }, children: { nodes: [] } });
  const respond = (query) => {
    if (query.includes('DeliveryCycleTeam')) {
      return { data: { team: { cyclesEnabled: true, timezone: 'Asia/Shanghai', cycleDuration: 1, cycleStartDay: 1, cycleCooldownTime: 0 } } };
    }
    if (query.includes('DeliveryCycleCycles')) {
      return { data: { cycles: { nodes: [{ id: 'cycle-1', startsAt: WEEK.start, endsAt: WEEK.end }], pageInfo: { hasNextPage: false } } } };
    }
    if (query.includes('DeliveryCycleLabel')) return { data: { issueLabel: { id: SCOPE.exclusionLabelId, team: { id: SCOPE.teamId } } } };
    if (query.includes('DeliveryCycleIssues')) return { data: { issues: { nodes: [issue('X')], pageInfo: { hasNextPage: false } } } };
    throw new Error(`unexpected ${query.slice(0, 40)}`);
  };
  const code = await main(ARGS, { ...sink, now: TUESDAY, git: async () => true, request: async (q) => respond(q) });
  const result = JSON.parse(sink.out.join(''));

  assert.equal(code, 0);
  assert.equal(result.status, 'synchronized');
  assert.equal(result.week.cycleId, 'cycle-1');
});
