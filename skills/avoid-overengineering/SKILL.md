---
name: avoid-overengineering
description: 避免过度设计，交付前通过消融实验删去不必要的抽象和设计。
disable-model-invocation: true
---

# 最简实现

用满足当前需求的最简单实现。

交付前做消融实验：逐项尝试移除或内联本次改动中的抽象和设计，用同一组验收检查对比前后。需求与约束仍满足就保留简化，否则恢复；无法验证的项保留并标为 Unknown。报告每项的去留和验证依据。
