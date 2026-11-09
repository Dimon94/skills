# dimon-mode 是工作方式入口，原则索引是其中一节

Status: accepted

Related: repo://skills/dimon-mode/SKILL.md；repo://docs/adr/0009-principle-leaves-and-index.md；repo://skills/no-comments/references/comment-sicko.md

## Context

ADR 0009 §4 把 `dimon-model` 定为原则叶子的显式调用索引，只写触发条件和引用规则。pstack 的同位 Skill 不是索引，是作者的工作方式入口：触发清单、原则、自主权、子代理、回复、注释和剧本路由放在一个显式调用的 Skill 里。用户决定照这个结构做自己的入口，并改名为 `dimon-mode`。

照搬注释规则时发现冲突：上游入口只保留“非显然的 why”，而 repo://docs/agents/layer-contracts.md 的 L3–L6 合同块（COORD、IN/OUT、INVARIANT、CHAIN 等）是给 agent 的索引。no-comments 的保留例外原本没有覆盖合同块。

## Decision

### 1. 入口取代索引

`skills/dimon-model` 改名为 `skills/dimon-mode`，SKILL.md 按七节组织：硬规则、原则、自主权、子代理、回复、注释、任务路由。原则节沿用 0009 的叶子与引用规则，按核心、架构、验证分组，只列已引入的叶子。不保留 `dimon-model` 别名。

### 2. 路由到本仓与运行时已有的 Skill

硬规则和任务路由只指向运行时目录里已有的 Skill（to-spec、vertical-slicing、implement、investigate 等），不引入上游剧本文件。上游剧本按课学习，学到时再决定是否扩充路由。照搬上游剧本会和 delivery-pipeline 及各阶段 Skill 形成第二套流程，因此否决。

### 3. 跨项目规则归入口，本仓规则归 AGENTS.md

dimon-mode 只写跨项目都成立的工作方式；项目 AGENTS.md 有更具体的规则时，按项目规则执行。AGENTS.md 的 `<principle_index>` 保留为常驻触发投影。把本仓 AGENTS.md 的全部规则搬进入口，会让本仓特有规则在其他项目误触发，因此否决。

### 4. 合同块不是叙述注释

入口的注释节分两类：叙述注释按自解释原则删除；项目有 `docs/agents/layer-contracts.md` 时，合同块按它维护，不删除。no-comments 的审查规则同步加入这条保留例外。

## Consequences

### 正面

- 显式调用一次即可在任何项目按 Dimon 的工作方式执行。
- no-comments 不再把 L1–L6 合同块判为可删。

### 负面 / 成本

- 入口与本仓 AGENTS.md 有重叠条目（回复口径、自主权、单线执行），改其中一处要检查另一处。
- 新增叶子仍要同改四处（来源清单、dimon-mode 原则节、AGENTS.md、README）。

### 边界

- 本 ADR 取代 0009 §4；0009 §1–§3 不变。
- 回退：把目录改回 `dimon-model`，SKILL.md 恢复为只有原则表，删除 comment-sicko.md 的合同块例外。
