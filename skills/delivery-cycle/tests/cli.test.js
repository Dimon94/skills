/**
 * CLI 公开入口：参数解析、依赖注入、退出码与 stdout JSON。
 * 替身只在 request（Linear transport）与 github 边界；不读真实钥匙串、不发网络请求。
 * 期望值来源：brief 第 4、6 条；Spec R1、§6 稳定结果表。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../scripts/run.js';
import { SCOPE, TUESDAY, WEEK } from './fake-adapters.js';

const ARGS = ['--team', SCOPE.teamId, '--project', SCOPE.projectId, '--exclusion-label', SCOPE.exclusionLabelId, '--transport', 'graphql'];

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
  const code = await main(ARGS, { ...sink, now: TUESDAY,
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
    labels: { nodes: [], pageInfo: { hasNextPage: false } } });
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
  const code = await main(ARGS, { ...sink, now: TUESDAY, request: async (q) => respond(q) });
  const result = JSON.parse(sink.out.join(''));

  assert.equal(code, 0);
  assert.equal(result.status, 'synchronized');
  assert.equal(result.week.cycleId, 'cycle-1');
});

// --------------------------------------------------------------------------
// --spec-acceptance：agent 读原验收评论后传入的快照
// --------------------------------------------------------------------------

test('--spec-acceptance 格式错误：退出码 2，零请求；合法值通过解析（对照）', async () => {
  const valid = await main([...ARGS, '--spec-acceptance', 'DD-1=c1:verified'], { ...io(), now: TUESDAY, request: async () => DENIED });
  assert.equal(valid, 1);

  const bad = ['DD-1', 'DD-1=c1', 'DD-1=c1:done', '=c1:verified', 'DD-1=:verified'];
  for (const value of bad) {
    const sink = io();
    const calls = [];
    const code = await main([...ARGS, '--spec-acceptance', value], { ...sink, request: async (q) => { calls.push(q); return DENIED; } });

    assert.equal(code, 2, value);
    assert.deepEqual(calls, []);
    assert.match(sink.err.join('\n'), /--spec-acceptance/);
  }
});

const SPEC_BODY = ['Problem Statement', 'Solution', 'User Stories', 'Implementation Decisions', 'Testing Decisions', 'Out of Scope']
  .map((h) => `## ${h}\n\n正文`).join('\n\n');

// 两个进行中的独立 Spec；可重复参数与逗号分隔都传到 Adapter：观察 comment(id:) 回读
test('--spec-acceptance 可重复、可逗号分隔，按 Spec identifier 传到 Evidence Adapter', async () => {
  const sink = io();
  const commentReads = [];
  const issue = (id) => ({ id, identifier: `DD-${id}`, description: SPEC_BODY, team: { id: SCOPE.teamId }, project: { id: SCOPE.projectId },
    state: { type: 'started' }, cycle: { id: 'cycle-1' }, parent: null, labels: { nodes: [], pageInfo: { hasNextPage: false } } });
  const respond = (query, v) => {
    if (query.includes('DeliveryCycleTeam')) {
      return { data: { team: { cyclesEnabled: true, timezone: 'Asia/Shanghai', cycleDuration: 1, cycleStartDay: 1, cycleCooldownTime: 0 } } };
    }
    if (query.includes('DeliveryCycleCycles')) {
      return { data: { cycles: { nodes: [{ id: 'cycle-1', startsAt: WEEK.start, endsAt: WEEK.end }], pageInfo: { hasNextPage: false } } } };
    }
    if (query.includes('DeliveryCycleLabel')) return { data: { issueLabel: { id: SCOPE.exclusionLabelId, team: { id: SCOPE.teamId } } } };
    if (query.includes('DeliveryCycleIssues')) return { data: { issues: { nodes: [issue('A'), issue('B'), issue('C')], pageInfo: { hasNextPage: false } } } };
    if (query.includes('DeliveryCycleAttachments')) return { data: { issue: { attachments: { nodes: [], pageInfo: { hasNextPage: false } } } } };
    if (query.includes('DeliveryCycleAcceptance')) {
      commentReads.push(v.id);
      return { data: { comment: { id: v.id, url: `https://linear.app/c/${v.id}`, createdAt: '2026-11-17T01:00:00Z', issue: { id: v.id.slice(-1) } } } };
    }
    throw new Error(`unexpected ${query.slice(0, 40)}`);
  };
  const argv = [...ARGS, '--spec-acceptance', 'DD-A=cA:verified,DD-B=cB:not_met', '--spec-acceptance', 'DD-C=cC:verified'];
  const github = async () => { throw new Error('不应调用 GitHub'); };
  const code = await main(argv, { ...sink, now: TUESDAY, github, request: async (q, v) => respond(q, v) });
  const result = JSON.parse(sink.out.join(''));

  assert.equal(code, 1); // 没有 PR attachment：main Unknown，结果不是 synchronized
  assert.deepEqual(commentReads.sort(), ['cA', 'cB', 'cC']);
  assert.deepEqual(Object.fromEntries(result.items.map((i) => [i.issueId, i.delivery.spec.state])), { A: 'verified', B: 'not_met', C: 'verified' });
});
