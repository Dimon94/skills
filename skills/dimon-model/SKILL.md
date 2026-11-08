---
name: dimon-model
description: Dimon 的工程判断入口：按触发条件列出可用的 principle-* 原则叶子。用于用户显式调用 /dimon-model 或 $dimon-model。
disable-model-invocation: true
---

# Dimon model

只在用户显式调用时执行。按下表把原则用于当前任务。

应用一条原则前，按运行时目录完整读取 `principle-<name>/SKILL.md`。回复里点名改变了某个决定的原则，以及它改变了哪个选择；只点名本会话读过叶子的原则。

## 原则索引

| 叶子 | 什么时候读 |
| --- | --- |
| `principle-model-the-domain` | 写有状态的逻辑；新需求要给分支链再加一支，或加一个要同步的标志位 |
| `principle-redesign-from-first-principles` | 把新需求接进现有设计 |
| `principle-fix-root-causes` | 调试；要用防护挡住一个症状前 |
