/**
 * Evidence Adapter 契约测试：原 Spec 与 main 合入证据只来自严格标记评论 + git 祖先校验。
 * 替身只在 request(query, variables) 与 git(args) 边界。
 * 期望值来源：brief 第 3 条；Spec §5 正式交付规则（状态、Done、正文声称都不算证据）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceAdapter } from '../scripts/evidence.js';
import { assessFormalDelivery } from '../scripts/delivery-cycle.js';

const SHA = 'a'.repeat(40);
const PARENT = { issueId: 'P', specRef: 'DD-1' };

function comment(body, n = 1) {
  return { body, url: `https://linear.app/dd/issue/DD-1#comment-${n}`, createdAt: `2026-11-1${n}T00:00:00.000Z` };
}

function adapterWith(pages, { ancestor = true } = {}) {
  const calls = [];
  const gitCalls = [];
  const request = async (query, variables) => {
    calls.push(variables);
    const [nodes, next] = pages[variables.after ?? 'first'];
    return { data: { issue: { comments: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } } } } };
  };
  const git = async (args) => { gitCalls.push(args); return ancestor; };
  return { calls, gitCalls, evidence: createEvidenceAdapter({ request, git }) };
}

test('严格标记 + main 祖先校验通过 → verified，来源是评论 URL 与 git:main@sha，时间取标记 at', async () => {
  const { gitCalls, evidence } = adapterWith({ first: [[
    comment('delivery-cycle:spec state=verified at=2026-11-17T09:00:00+08:00', 1),
    comment(`delivery-cycle:main sha=${SHA} at=2026-11-17T10:00:00+08:00`, 2)
  ], null] });
  const input = await evidence.read(PARENT);

  assert.deepEqual(input.spec, { state: 'verified', source: 'https://linear.app/dd/issue/DD-1#comment-1',
    effectiveAt: '2026-11-17T09:00:00+08:00', reason: null });
  assert.deepEqual(input.main, { state: 'verified', source: `git:main@${SHA}`,
    effectiveAt: '2026-11-17T10:00:00+08:00', reason: null });
  assert.deepEqual(gitCalls, [['merge-base', '--is-ancestor', SHA, 'main']]);
  assert.equal(assessFormalDelivery(input).status, 'delivered');
});

test('标记在第二页也能找到；分页游标前进', async () => {
  const { calls, evidence } = adapterWith({
    first: [[comment('普通讨论', 1)], 'c1'],
    c1: [[comment('delivery-cycle:spec state=not_met at=', 2)], null]
  });
  const input = await evidence.read(PARENT);

  assert.deepEqual(calls.map((v) => [v.id, v.after]), [['P', null], ['P', 'c1']]);
  assert.equal(input.spec.state, 'not_met');
  assert.equal(input.spec.effectiveAt, null);
});

test('状态 Done、正文“已验收已合入”、松散写法都不算证据 → unknown 并给原因', async () => {
  const { gitCalls, evidence } = adapterWith({ first: [[
    comment('Spec 已验收，已合入 main', 1),
    comment('delivery-cycle:spec state=done at=2026-11-17T09:00:00+08:00', 2),
    comment(`前缀 delivery-cycle:main sha=${SHA} at=`, 3),
    comment('引用 delivery-cycle:spec state=verified at=2026-11-17T09:00:00+08:00', 4)
  ], null] });
  const input = await evidence.read(PARENT);

  assert.equal(input.spec.state, 'unknown');
  assert.equal(input.main.state, 'unknown');
  assert.ok(input.spec.reason && input.main.reason);
  assert.deepEqual(gitCalls, []);
  assert.equal(assessFormalDelivery(input).status, 'unknown');
});

test('标记的 sha 不在 main 上 → main unknown，不是 verified', async () => {
  const { evidence } = adapterWith({ first: [[comment(`delivery-cycle:main sha=${SHA} at=2026-11-17T10:00:00+08:00`)], null] },
    { ancestor: false });
  const input = await evidence.read(PARENT);

  assert.equal(input.main.state, 'unknown');
  assert.match(input.main.reason, /不在 main/);
});

test('main 标记缺 at：verified 但 effectiveAt 为 null，不拿提交日期补', async () => {
  const { evidence } = adapterWith({ first: [[
    comment('delivery-cycle:spec state=verified at=2026-11-17T09:00:00+08:00', 1),
    comment(`delivery-cycle:main sha=${SHA} at=`, 2)
  ], null] });
  const input = await evidence.read(PARENT);

  assert.equal(input.main.state, 'verified');
  assert.equal(input.main.effectiveAt, null);
  assert.equal(assessFormalDelivery(input).effectiveAt, null);
});

test('同一条件多次标记，以最新评论为准', async () => {
  const { evidence } = adapterWith({ first: [[
    comment('delivery-cycle:spec state=verified at=2026-11-11T09:00:00+08:00', 1),
    comment('delivery-cycle:spec state=not_met at=', 3)
  ], null] });

  assert.equal((await evidence.read(PARENT)).spec.state, 'not_met');
});

test('评论读取失败抛出（由核心转 evidence_unavailable），不伪造结论', async () => {
  const evidence = createEvidenceAdapter({
    request: async () => ({ data: null, errors: [{ message: 'Internal error' }] }),
    git: async () => true
  });
  await assert.rejects(evidence.read(PARENT), { code: 'capability_unavailable' });
});

test('createGitAncestry：真实 git 退出码 0 = 祖先，1 = 不是，无此 sha 抛出（临时仓库，无网络）', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createGitAncestry } = await import('../scripts/evidence.js');
  const repo = mkdtempSync(join(tmpdir(), 'delivery-cycle-git-'));
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]).toString().trim();
  try {
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'one');
    const onMain = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'side');
    git('commit', '-q', '--allow-empty', '-m', 'two');
    const offMain = git('rev-parse', 'HEAD');
    const ancestry = createGitAncestry(repo);

    assert.equal(await ancestry(['merge-base', '--is-ancestor', onMain, 'main']), true);
    assert.equal(await ancestry(['merge-base', '--is-ancestor', offMain, 'main']), false);
    await assert.rejects(ancestry(['merge-base', '--is-ancestor', 'b'.repeat(40), 'main']));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
