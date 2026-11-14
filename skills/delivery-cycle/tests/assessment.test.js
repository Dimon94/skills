/**
 * delivery-cycle assessment 测试
 * 覆盖 R4、R14、R15：正式交付判断逻辑
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFormalDelivery } from '../scripts/delivery-cycle.js';

test('R4/R14: verified + verified → delivered，effectiveAt 为较晚值', async () => {
  // 独立预期：Spec §2、手算 2026-11-16T03:00:00Z > 2026-11-16T02:00:00Z
  const result = assessFormalDelivery({
    spec: { state: 'verified', source: 'spec-owner', effectiveAt: '2026-11-16T02:00:00Z', reason: null },
    main: { state: 'verified', source: 'closeout-owner', effectiveAt: '2026-11-16T03:00:00Z', reason: null }
  });

  assert.equal(result.status, 'delivered');
  assert.equal(result.effectiveAt, '2026-11-16T03:00:00Z');
  assert.equal(result.spec.state, 'verified');
  assert.equal(result.main.state, 'verified');
});

test('R4: 九种 spec × main 组合只服从唯一公式；附带的状态、HTTP 与提交时间不替代证据', async () => {
  // 独立预期：Spec R4 与第 2 节 Ensures，逐格手写
  const expected = {
    verified: { verified: 'delivered', not_met: 'not_delivered', unknown: 'unknown' },
    not_met: { verified: 'not_delivered', not_met: 'not_delivered', unknown: 'not_delivered' },
    unknown: { verified: 'unknown', not_met: 'not_delivered', unknown: 'unknown' }
  };
  const noise = { statusType: 'completed', integration: true, httpStatus: 200, claimed: 'delivered', committedAt: '2026-11-10T00:00:00Z' };
  for (const [spec, row] of Object.entries(expected)) {
    for (const [main, status] of Object.entries(row)) {
      const evidence = (state) => ({ state, source: state === 'unknown' ? null : 'owner', effectiveAt: null, reason: null, ...noise });
      assert.equal(assessFormalDelivery({ spec: evidence(spec), main: evidence(main) }).status, status, `${spec} × ${main}`);
    }
  }
});

test('R14: 已交付但任一时间缺失时 effectiveAt=null', async () => {
  // 独立预期：Spec R14
  const result = assessFormalDelivery({
    spec: { state: 'verified', source: 'spec-owner', effectiveAt: null, reason: null },
    main: { state: 'verified', source: 'closeout-owner', effectiveAt: '2026-11-16T03:00:00Z', reason: null }
  });
  assert.equal(result.status, 'delivered');
  assert.equal(result.effectiveAt, null);
});

test('F6/R15：verified 或 not_met 缺 source 视为 unknown；形状缺失不抛错', () => {
  // 独立预期：修复清单 F6——无来源的结论不是证据
  const ok = { state: 'verified', source: 'owner', effectiveAt: '2026-11-16T02:00:00Z', reason: null };
  const noSource = (state) => ({ state, source: null, effectiveAt: '2026-11-16T02:00:00Z', reason: null });
  assert.equal(assessFormalDelivery({ spec: noSource('verified'), main: ok }).status, 'unknown');
  assert.equal(assessFormalDelivery({ spec: noSource('not_met'), main: ok }).status, 'unknown');
  assert.equal(assessFormalDelivery({}).status, 'unknown');
  assert.equal(assessFormalDelivery({ spec: ok, main: ok }).status, 'delivered');
});

test('G7/R14：effectiveAt 不是可解析的 ISO 8601 字符串 → 置 null；两种参数顺序一致', () => {
  // 独立预期：修复清单 G7——不可核实的时间不参与较晚值比较
  const at = (effectiveAt) => ({ state: 'verified', source: 'owner', effectiveAt, reason: null });
  const good = at('2026-11-16T02:00:00Z');
  for (const bad of ['garbage', 1763258400000, 'Nov 16 2026']) {
    for (const input of [{ spec: at(bad), main: good }, { spec: good, main: at(bad) }]) {
      const result = assessFormalDelivery(input);
      assert.equal(result.status, 'delivered');
      assert.equal(result.effectiveAt, null, String(bad));
    }
  }
});

test('G7：assessFormalDelivery(null／undefined) 不抛错，按两条 unknown 处理', () => {
  for (const input of [null, undefined]) {
    const result = assessFormalDelivery(input);
    assert.deepEqual([result.status, result.spec.state, result.main.state], ['unknown', 'unknown', 'unknown']);
  }
});
