# 小需求

Issue 即票，不写 Spec，不做事前预览。

1. 按 [`bdd`](../../bdd/SKILL.md) 在公开入口先红后绿，实现 Issue 的可检查结果。
2. 对照 Issue 的可检查结果逐项自检。实现中发现越界，立即按[判定规模](../SKILL.md#判定规模)升级。
3. 合入前用 [`spec-preview`](../../spec-preview/SKILL.md) 的 `delta` 生成变更预览，按[预览门](../../git-rebase-main/references/closeout.md#预览门)等用户确认。

回复写三段：改了什么、公开入口怎么验证、变更预览坐标与确认状态。
