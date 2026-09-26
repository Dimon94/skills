---
name: investigate
description: "只读调研本仓代码与历史，产出带引用的解释或方案推荐。用于「调研 / investigate」「搞清楚 X」「A 还是 B」「确定吗」类请求；机制走 how，动机叠加 why，不改代码。"
---

# Investigate

调研是只读任务：产出带引用的解释或推荐，不产出代码变更、不开 PR。

## Step 1. 路由

- 机制问题（X 怎么工作、该放哪层、归谁所有）：走 `how` skill。
- 动机问题（为什么这样设计、为什么选 Y）：在 `how` 之外叠加 `why` skill。
- 方案决策（A 还是 B）：用 `how` 收集事实，自己完成比较。

## Step 2. 输出

- 解释类：用 `how` 的输出形状（Overview / Key Concepts / How It Works / Where Things Live / Gotchas）。
- 决策类：给明确推荐 + tradeoffs 表。
- 「确定吗」类：给真实判断和理由；前提错了先纠正前提，再回答问题。

## 边界

调研结论是「要改代码」时，把结论交还用户，由用户另起修复或功能流程。调研本身不改代码。
