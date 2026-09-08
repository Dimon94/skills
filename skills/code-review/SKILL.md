---
name: code-review
description: "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\"."
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings.

The issue tracker should have been provided to you. If `docs/agents/issue-tracker.md` is missing, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point (a commit SHA, branch name, tag, `main`, `HEAD~5`, etc.). If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

如果 caller 提供了已物化的 Review Evidence Bundle，先核验 fixed point、HEAD、精确 diff 关系、
完整路径清单与 staged/worktree 状态，再复用该快照；不另选基线。WIP 审查必须覆盖请求范围内
的 staged、unstaged 和 untracked additions。存在无关 dirty 时，父会话提供隔离快照与范围清单；
不能把无关改动混入本次审查。两轴共用不可变证据，当前源码只补充上下文。

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here, not inside two parallel sub-agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched via the workflow in `docs/agents/issue-tracker.md`.
2. A path the user passed as an argument.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Spawn both sub-agents in parallel

先确定 review scope。caller 显式传 `implementation` 或 `whole-change`；若未传，普通 branch、
PR 与 WIP review 按 `implementation`。只有 caller 明确传入 `whole-change`，且 Review Evidence
Bundle 的 fixed point 是 map registry creation base，才按 whole-change 执行。

以下为 Codex runtime 的参考默认值；用户明确选择的 model/effort 优先，可覆盖整个 Review 或单轴。
caller 传递选择来源与作用范围，两轴按最终选择显式请求，未覆盖字段沿用默认值：

- `implementation`：`model: gpt-6-astra`、`reasoning_effort: low`。
- `whole-change`：`model: gpt-5.6-sol`、`reasoning_effort: xhigh`。

先核对宿主 spawn schema；完整历史 fork 若不支持模型覆盖，选择可覆盖的独立上下文形式
（当前 `fork_turns: none`），传完整任务、规则/spec 与共享证据绝对路径。检查选用的自定义
agent 文件是否覆盖模型/effort；请求值、工具接受与运行 readback 分别记录，缺证据写 Unknown。
指定模型启动失败时报告审查受阻，不静默替换模型或 effort。
非 Codex runtime 保留其原生子代理模型选择方式，仍执行相同两轴合同。

两轴均为只读，只交 findings/verdict；不编辑文件、不提交、不扩大权限。主 reviewer 可以直接按需
委派 `gpt-5.6-luna` / `max` 做有界只读检索，模型与 effort 同时传递；主 reviewer 保留正式判断，
不能把本轴整体转交 Luna。修复改变审查内容后，父会话更新证据快照并复核受影响轴/范围，
原 verdict 不覆盖新改动。second opinion 不替代此正式 Review。implementation 与 whole-change
使用不同 fixed point，前者验证单票交付，后者验证集成后的跨票行为，不能互相代替。

**Standards sub-agent prompt** should include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full (the sub-agent has no other access to it).
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** should include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

### 5. Aggregate

中断、超时、失联或缺少最终 verdict 均为未完成。执行者不得以自评、测试通过或“已修复”
替代独立复核；不得要求 reviewer 为赶进度直接通过。取消审查必须记录原因并恢复或重派，
取消本身不免除审查义务。只有用户明确豁免可改变要求，保留用户原话、来源和范围，不写成 PASS。
有 coordinator 时，由 coordinator 管理正式 reviewer 的启动、取消与恢复，实施 worker 只提交
候选代码与修复说明。coordinator 从 reviewer 宿主任务直接读取最终结果，不采信实施者转述。
每轴返回 reviewer/task ID、审查 base 与 head（WIP 则 snapshot）、最终 verdict、未解决 finding。
修复后必须取得覆盖新版本的独立结论；中断的复核不能沿用修复前 verdict 放行。

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings, because the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
