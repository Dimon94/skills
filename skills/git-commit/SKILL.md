---
name: git-commit
description: Create narrow auditable local commits. Use when verified work must be staged and committed without absorbing unrelated changes.
---

# Git Commit

## 选择执行环境

1. 从当前运行时识别 Harness；模型的 provider 或名称不代表 Harness。
2. 只加载当前 Harness 的参考：Pi → [pi.md](references/pi.md)；Codex → [codex.md](references/codex.md)。身份不明或没有对应参考时，报告受阻；不套用其他 Harness 的规则。
3. 只读写 `~/.git-commit/<当前 harness>/config.yaml`。不枚举或读取兄弟 Harness 目录。配置缺失时，按对应参考发现模型；复用本会话已确认的选择，否则请用户选择后保存。配置失效时请用户重新选择。
4. 按参考核验模型和推理强度。请求参数、模型自述不等于运行证据；证据缺失记 `Unknown`，实际不匹配则报告期望值与实际值。两者均阻断 staging 和 commit，不静默换模型。

用户级配置保存 `model` 和 `reasoning_effort`；模型标识格式由对应参考规定。运行时配置不入仓。新增 Harness 时，只在有官方调用合同或运行证据后添加参考和入口指针。

## 委派边界

委派前明确提交授权、目标 repo/worktree、允许提交的路径或 hunks、必须保留的改动与验证证据。提交执行者核验通过后，父会话和其他代理停止写该 worktree 与 index，只保留一个写入者。

子代理直接执行下节，不再次委派本 Skill。回传 commit hash、提交路径、验证结果及剩余 dirty；父会话用 Git 读回核验范围。修改本 Skill 本身不构成提交授权。

## 本地提交

检查 `git status --short --branch` 和每个 dirty 路径，明确本次范围及保持不动的改动。

每个提交只覆盖一个语义边界。显式 stage 路径或 hunks，检查 cached diff，运行 `git diff --cached --check` 和能证明 staged 变更的最小检查。使用 Conventional Commit 标题，正文记录问题、变更、理由、验证和风险。

只创建本地提交。不 push、不打开评审项、不合并、不切换源 worktree 分支。完成后报告 hash，并核验无关改动保持不变。
