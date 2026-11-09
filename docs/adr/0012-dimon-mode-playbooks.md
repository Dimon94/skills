# dimon-mode 用剧本串联已有 Skill

Status: accepted

Related: repo://docs/adr/0010-dimon-mode-entry.md；repo://skills/dimon-mode/playbooks/bug-fix.md；repo://skills/retro/SKILL.md

## Context

ADR 0010 §2 规定 dimon-mode 只路由到已有 Skill，不引入上游剧本文件，理由是照搬剧本会和各阶段 Skill 形成第二套流程。

修缺陷的零件都已存在（how、why、tdd 缺陷行、principle-fix-root-causes、code-review），但没有一个 Skill 拥有它们的顺序，也没有 Skill 写“推翻的假设要回退”“单元测试证明不了缺陷消失”“失败的复现先于修复提交”和回复格式。pstack 的 poteto-mode 同为显式调用入口，把这类顺序放在 `playbooks/` 下。

同时发现缺陷：implement、code-review 在 R3 出口要求运行 `retro`，它是 mattpocock 的外部 Skill，不在本仓与来源清单内，且 `disable-model-invocation: true`，agent 无法调用（引入于 `28e5cfc`）。

## Decision

### 1. 剧本归入口，只放指针

dimon-mode 可以在 `playbooks/` 下拥有剧本。剧本只写步骤顺序、硬规则和回复格式，步骤内容指向已有 Skill 与原则叶子，不复制它们的正文。本条修订 0010 §2；当某个顺序已由一个 Skill 拥有时，仍然只路由到那个 Skill。

否决新增独立 `bug-fix` Skill：它会多一条常驻 description，并形成入口之外的第二个入口；pstack 也把同类顺序放在入口的剧本里。代价是剧本只在显式调用 dimon-mode 时可达，其他场景由项目 AGENTS.md 的调试指针承担。

### 2. retro 转为本仓自有，与 postmortem 分工

本仓新增 `retro`：把失败链路变成 agent 环境改动建议，等用户批准。`postmortem` 继续拥有教训的记录与召回，不提出环境改动。依赖单向：retro 用 postmortem 的 recall，postmortem 不知道 retro。R3 出口两者都调用：postmortem 记录，retro 提建议。

否决改为“请用户输入 /retro”：R3 出口会卡在人身上，且依赖仍不归本仓。

## Consequences

### 正面

- 修缺陷有一个可路由的顺序，补上了 pstack bug-fix 的四条硬规则。
- R3 出口的两个调用目标都归本仓、agent 可调用。

### 负面 / 成本

- 剧本只在 dimon-mode 下可达。
- 本仓 retro 与 mattpocock retro 同名，`scripts/link-skills.sh` 会把运行时目录里的 `retro` 改指向本仓。

### 边界

- 本 ADR 修订 0010 §2，0010 其余各节不变。
- 不裁决其他外部 Skill 引用（to-tickets、wayfinder 等同样是 agent 不可调用的外部 Skill）。
- 回退：删除 `skills/dimon-mode/playbooks/` 与路由行；删除 `skills/retro`，R3 出口改回原文。
