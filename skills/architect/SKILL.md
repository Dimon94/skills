---
name: architect
description: 写代码前画出两种形状并按状态归属选定。用于改动跨过函数边界、要新建或改 Module 与 Interface、to-spec 写 Implementation Decisions，或同一处的绕行补丁第二次出现。
---

# Architect

形状指类型、签名和 Module 边界。本 Skill 在写代码前定形状，实现过程中形状被证伪时回到这里。

## 步骤

1. 追踪改动触及的每个系统：入口、调用方、持久状态、外部服务和已有 Seam。完成条件：列出的每一处都有代码坐标或 Unknown。
2. 画两种不同的形状，用目标项目的语言写类型和函数签名，函数体留空。两种形状要在状态放哪、谁调用谁上不同，只改命名不算。
3. 按三条标准比较，选一个：
   - 每个状态有一个 owner。
   - 一件事只有一种做法。
   - 调用方需要知道的最少。
4. 为选定的形状写状态归属表：改动读写的每个状态一行，写 `状态 → owner Module`。有一行答不出，形状就还没选定，回到第 2 步。完成条件：表中每个状态恰好一个 owner。
5. 输出选定形状的签名、状态归属表，以及另一个形状落选的一句理由。

## 何时重画

- 实现中同一处出现第二个绕行补丁：停下，按 `principle-redesign-from-first-principles` 重画，不追加补丁。
- 新需求要给分支链加一支，或加一个要同步的标志位：先读 `principle-model-the-domain`。
- 两种形状按三条标准分不出高下，或没有先例可循：按 `principle-exhaust-the-design-space` 做原型并排比，再选。
