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
