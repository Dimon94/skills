---
name: delegate-ticket
description: "按实施合同准备派发合同：绑定票、场景、基线、先例、可写范围和带独立预期的检查；用于用户显式调用 /delegate-ticket。"
disable-model-invocation: true
---

# Delegate Ticket

技术负责人把一张实施合同补成可执行的派发合同。输入字段与输出归 [交接合同](../to-tickets/references/delivery-contract.md) 的 `Ticket`、`Scenario`、`Brief` 和 `MissingDecision` 所有。

A01 只冻结公开调用点。`scripts/prepare.js` 导出 `prepare(ticket, scenarios, base)`，当前显式抛出 `ERR_NOT_IMPLEMENTED`。A03 接入准备行为，继续返回一份或多份 `Brief`，缺少业务决定时返回 `MissingDecision`。
