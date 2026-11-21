// L3  输入为原票、Spec 场景及目标提交。公开签名见 to-tickets/references/delivery-contract.md。
// L4  合同桩不派发。调用者取得显式失败，不能把空集合当作已完成。
function prepare(ticket, scenarios, base) {
  throw Object.assign(new Error(`${ticket.id}：prepare 尚未实现`), { code: 'ERR_NOT_IMPLEMENTED' });
}

module.exports = { prepare };
