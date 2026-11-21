# Review 每个 MMF 一轮，阻断 finding 必须带可跑反例

Status: accepted

Related: supersedes repo://docs/adr/0008-review-round-limit.md 的第 1、5 条（三轮上限与 R3 退出）；repo://docs/adr/0015-mmf-delivery-unit.md；repo://skills/code-review/SKILL.md；repo://skills/implement/SKILL.md；repo://skills/gh-merge-pr/SKILL.md；delivery-pipeline 仓对应 ADR

## Context

ADR-0008 把 Review 限到三轮后，审查仍然跑满。证据：

- JB-190 whole-change 账本 P1 数 10 → 4 → 0，三轮跑满（`~/.config/delivery-pipeline/artifacts/tkada-jb190/review-budget/whole-change-JB-190.json`）；DD-230 为 FIX → FIX → PASS；DD-291 implementation scope 为 PASS → FIX → PASS。
- JB-190 R1 里 Standards 与 Spec 两轴有三对重复 finding（ST-3/SP-2、ST-4/SP-3、ST-5/SP-7）；ST-1 本可由 `deploy/ci/check.sh:204` 拦下。
- 同一 MMF 先逐票审查，合入时再整体审查，一处改动被审两遍以上。

R1 也有测试与形式验证抓不到的价值：JB-190 的缺自选日期（SP-4）、测试固化了错误映射（SP-1）、真实生产报表入库（ST-2）、混币种相加（ST-6）。所以不取消 Review，只取消重复轮次和无反例的 finding。

2026-11-21 用户决定：Review 单位是 MMF，只在 MMF 收口时审一次；验证力度投给实证分析和形式验证。100 行改动里有 3 个 P1，应一次查全，不应分三轮各查出一个。

## Decision

1. Review 单位是 MMF。实现单张票或 MMF 的一部分时不审查；整个 MMF 合入前审一次。没有 spec 的独立小改不审，靠测试与真实运行。
2. 每个 scope 只有一轮。修复不开复审：每条 P0/P1 的反例变绿，且完整测试与项目 CI 命令通过，即视为关闭。反例改不绿时停止交付，运行 `retro`。
3. P0/P1 必须带可跑反例：一条在当前代码上失败的测试或命令；或 spec 原文引用加具体输入与实际输出；或密钥、数据外泄的 file:line。没有反例的降为 P2 或 Unknown。
4. Spec 轴每次都跑。Standards 轴只在 diff 触及权限、数据外泄、持久 schema 或外部合同，且没有检查或形式验证覆盖时运行。
5. 审查前先跑项目的 canonical CI 或检查命令，工具能拦的不交给审查者。

## Consequences

- 修复后的回归由测试兜底。修复引入的新缺陷不会被审查者看到，P1 的反例测试和完整测试成为唯一门槛。
- 票级缺陷要到 MMF 收口才被审查发现，返工批量变大；票级验证仍由 `implement` 第 3 步承担。
- 反例要求让审查者更难报出真实但难复现的问题，这类问题以 P2 或 Unknown 进入积压。

Backlog：账本给每条 P1 标“测试或形式验证能否发现”；连续 5 个 MMF 的 Spec 轴没有独有 P1 时，重开本记录讨论取消 Review。
