---
name: code-review
description: "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs the reviews in parallel sub-agents, one review per MMF, and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\"."
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

Each axis that runs gets its own **parallel sub-agent** so they don't pollute each other's context, then this skill aggregates their findings. Start every sub-agent with a fresh context window. Standards runs only when step 4 says so.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point (a commit SHA, branch name, tag, `main`, `HEAD~5`, etc.). If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

调用方提供 Review Evidence Bundle 时，核验其 fixed point、HEAD、diff 关系与路径清单后复用，不另选基线。WIP 审查覆盖请求范围内的 staged、unstaged 与 untracked 改动。

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here, not inside two parallel sub-agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched via the workflow in the tracker doc.
2. A path the user passed as an argument.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

### 3. Identify the standards sources

Search the repo for every file that documents how code should be written. When `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists, it must be on the list.

A finding needs a concrete trigger and an observable impact. Taste, naming, YAGNI and speculative refactors are out of scope.

审查前先跑项目的 canonical CI 或检查命令（调用方已跑且 HEAD 未变时引用其结果）。失败项直接交调用方修，不派审查者。

### 4. Spawn the sub-agents in parallel

Spec 轴每次都跑。Standards 轴只在 diff 触及权限、数据外泄、持久 schema 或外部合同，且这些改动没有检查或形式验证覆盖时才跑；不跑时在报告里写 `Standards: skipped` 和理由。

Issue the sub-agent calls together, in the foreground, and aggregate the reports they return.

**Standards sub-agent prompt** should include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3.
- The brief: "Find every P0/P1 now: trace main paths, permissions, persisted state and external contracts. For each one, check the same class elsewhere in the diff. Report it with the standard it breaks (file + rule). Mention P2/P3 only when you meet them; do not hunt for them. Skip anything tooling enforces. P0/P1 are uncapped; everything else stays under 200 words."

**Spec sub-agent prompt** should include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Find every P0/P1 now. Report: (a) requirements the spec asked for that are missing or partial; (b) unrequested behaviour that changes what users or callers observe; (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. For each P0/P1, check the same class elsewhere in the diff. P0/P1 are uncapped; everything else stays under 200 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

两份 brief 都追加一句：每条 finding 按「严重度」节标 P0–P3，并写出触发场景与可观察影响。P0/P1 必须附可跑反例，三选一：在当前代码上失败的测试或命令；spec 原文引用加具体输入与实际输出；密钥或数据外泄的 file:line。给不出反例的降为 P2 或写 Unknown。P0/P1 先在 fixed point 上核对同一问题是否已存在，按「严重度」节的基线规则定级。

Spec brief 再追加一句：spec 某行的措辞容许两种可观察行为不同的实现时，不判实现对错；引该行、写出两种读法，列为 Spec 缺口。

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings, because the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary: per axis, the verdict, the finding count by severity, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

每轴 verdict 只取两值：存在未解决的 P0/P1 为 `BLOCK`，否则为 `PASS`。验证缺口和 Spec 缺口写进报告，不改变 verdict；Spec 缺口交调用方收紧 spec 措辞。审查中断、超时或缺少 verdict 时为未完成，重跑同一轮，不以实现者自评或测试通过代替。

## 严重度

每条 finding 标一个级别。目标项目质量规范定义了 P0–P3 时用项目定义，否则用下表：

- P0：正在造成不可逆数据损坏、严重安全问题或全面不可用。
- P1：主路径必然失败、权限绕过、持久状态污染或外部合同破坏。
- P2：特定条件下出错、恢复失败、明显性能回归或高扩散维护风险。
- P3：局部清晰度或一致性问题，当前不破坏行为。

只有 P0/P1 阻断；调用方所说的 blocker、blocking finding 都指 P0/P1。P2 交调用方登记 issue，P3 只留在报告里，两者都不触发下一轮。级别由审查者给出，实现者不能降级。

fixed point 上已存在的问题不由本次承担：记为 P2，标「基线已有，原级 P0/P1」，交调用方登记 issue。本次 diff 复制了它，或让新的调用方、入口走到它时，按原级别处理。审查者核对不了 fixed point 时，按本次引入处理。

## 轮次

审查单位是 MMF：整个 MMF 合入前审一次，单张票或 MMF 的一部分不审。每个 scope 只有一轮，看完整 diff，一次找全 P0/P1。

修复不开复审。每条 P0/P1 的反例变绿，且完整测试与项目 CI 命令通过，该 finding 即关闭，由调用方记录关闭证据。反例改不绿时，调用方停止交付，运行 `postmortem` 与 `retro`。

scope 由调用方定义；delivery-pipeline 链路按其 Review 预算计。取舍见 repo://docs/adr/0022-one-review-per-mmf.md。

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
