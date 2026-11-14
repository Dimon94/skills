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

test('R4/R14: 任一 not_met → not_delivered', async () => {
  // 独立预期：Spec §2
  const result1 = assessFormalDelivery({
    spec: { state: 'not_met', source: 'spec-owner', effectiveAt: null, reason: 'Requirements not satisfied' },
    main: { state: 'verified', source: 'closeout-owner', effectiveAt: '2026-11-16T03:00:00Z', reason: null }
  });
  assert.equal(result1.status, 'not_delivered');

  const result2 = assessFormalDelivery({
    spec: { state: 'verified', source: 'spec-owner', effectiveAt: '2026-11-16T02:00:00Z', reason: null },
    main: { state: 'not_met', source: 'closeout-owner', effectiveAt: null, reason: 'Not merged to main' }
  });
  assert.equal(result2.status, 'not_delivered');
});

test('R4/R14: 其余组合 → unknown', async () => {
  // 独立预期：Spec §2
  const result = assessFormalDelivery({
    spec: { state: 'unknown', source: null, effectiveAt: null, reason: 'Evidence unavailable' },
    main: { state: 'verified', source: 'closeout-owner', effectiveAt: '2026-11-16T03:00:00Z', reason: null }
  });
  assert.equal(result.status, 'unknown');
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
