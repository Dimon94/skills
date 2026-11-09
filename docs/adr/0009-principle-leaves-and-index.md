# 原则以叶子快照进入套件，宿主只放指针

Status: accepted；§4 superseded by repo://docs/adr/0010-dimon-mode-entry.md

Related: repo://skills/dimon-mode/SKILL.md；repo://skills/sync-upstream-skills/references/sources.json；repo://docs/adr/0001-curated-upstream-skill-snapshots.md

## Context

学习 pstack 时，第 4、5 课把 `principle-fix-root-causes`、`principle-model-the-domain` 的判断改写进了 `docs/agents/debugging.md` 和 `to-spec`。原则正文因此散落在宿主里，下一个宿主还得再抄一遍。用户决定：原则进入套件，宿主按渐进式披露引用；另建只能显式调用的索引 Skill，AGENTS.md 放常驻索引。

## Decision

### 1. 叶子是上游快照

原则叶子放进 `skills/principle-*`，由 repo://skills/sync-upstream-skills/references/sources.json 的 `cursor-pstack` 来源锁定，复用 ADR 0001 的机制。需要本地改写的叶子退出清单，成为本仓自有 Skill。把原则译写进 `docs/agents/` 会让宿主各抄一份，因此否决。

### 2. 按课引入

只引入已有宿主引用的叶子。一次装入全部 24 片会出现没人引用的叶子，因此否决。

### 3. 宿主只放指针

宿主 Skill 和 docs 只写触发点、要读的叶子和产物要记录什么，不复制叶子正文。

### 4. 两层索引

`dimon-model`（`disable-model-invocation: true`）是显式调用的完整索引，只写触发条件和引用规则。宿主映射、来源和维护步骤写在 README，SKILL.md 不写维护与上游信息，免得干扰 agent 判断。AGENTS.md 的 `<principle_index>` 是常驻触发投影。两者的触发文字都以叶子 description 为准。

## Consequences

### 正面

- 原则只有一个 owner，上游更新可用 `sync-upstream-skills --check` 发现。

### 负面 / 成本

- 叶子是英文原文，中文讲解留在学习材料里。
- 新增叶子要同改四处（来源清单、dimon-model、AGENTS.md、README），漏改只能靠人工审查发现。

### 边界

- project-template 的 debugging.md 保留原文段落：派生项目不一定装了本仓运行时（推断）。
- 回退：删除 `skills/principle-*`、`skills/dimon-model`、来源条目和 `<principle_index>`，在宿主恢复原文段落。
