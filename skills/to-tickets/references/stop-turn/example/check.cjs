const assert = require('node:assert/strict');
const { stop } = require('./turn.js');

// 独立预期取自 Spec 的 S1；单片和整票走同一回合详情入口。
const scope = process.argv[2];
assert.ok(['status', 'results', 'all'].includes(scope), '用法：node check.cjs status|results|all');
const detail = stop({ status: 'running', results: ['第一段'] });
if (scope !== 'results') assert.equal(detail.status, 'stopped', 'S1：回合应显示已停止');
if (scope !== 'status') assert.deepEqual(detail.results, ['第一段'], 'S1：详情应仍可读到「第一段」');
console.log(JSON.stringify(scope === 'all' ? detail : detail[scope]));
