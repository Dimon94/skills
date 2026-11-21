// L3  输入为一份派发合同或 MMF 计划。公开签名见 to-tickets/references/delivery-contract.md。
// L4  合同桩不执行命令。调用者取得显式失败，不能形成局部证据或整体验收结论。
function implement(input) {
  throw Object.assign(new Error(`${input.ticket ?? input.mmf}：implement 尚未实现`), { code: 'ERR_NOT_IMPLEMENTED' });
}

module.exports = { implement };
