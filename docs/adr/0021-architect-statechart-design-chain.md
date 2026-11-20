# 设计链接入 architect 与 statechart

Status: accepted

Related: 补充 repo://docs/adr/0007-owned-to-spec.md 与 repo://docs/adr/0016-spec-writes-interface-as-code.md；repo://skills/architect/SKILL.md；repo://skills/to-spec/SKILL.md；repo://skills/to-spec/scripts/check-spec.js；repo://skills/statechart/SKILL.md；repo://skills/dimon-mode/SKILL.md

## Context

pstack 0.15.43 起，`/architect` 只剩一个动作：写代码前画两种形状，按三条标准选一个（每个状态一个 owner、一件事一种做法、调用方知道最少）。选定的检验是每个状态能用一行答出 owner。本仓没有 architect：`dimon-mode` 的 bug-fix 剧本去掉了它，`to-spec` 只要求每个 T、R 有唯一 owner Module，没有检查状态本身的归属。

pstack 新增 `/statechart`：用 TLC 检查 TLA+ 模型，画 Mermaid 状态图，并把每条违规写成最短路径。`to-spec` 的 Business Flow 已用同一套写法（读者词、`T<n>`/`R<n>`、约 20 条箭头），但只停在画图，不检查规则。

## Decision

1. 新建本仓自有 `architect`，模型可调用。保留两种形状与三条标准；选定后写状态归属表，有一行答不出就未选定。大型或有争议的设计用 `principle-exhaust-the-design-space` 做原型比较，不引入 `arena`（多模型并发成本，见 repo://docs/research/2026-11-04-pstack-development-workflow.md）。
2. `to-spec` 第 5 步调用 `architect` 定形状。`Owns:` 行同时列 Business Flow 的状态 id；`check-spec.js` 要求每个状态恰好出现在一条 `Owns:` 行，规则名 `state`。
3. `statechart` 作为上游快照导入，保持用户调用。`dimon-mode` 在 `to-spec` 收尾时，对含失败、重试或取消箭头的 Business Flow 建议运行 `/statechart`，违规路径补成 Testing Decisions 的检查。代码级不变量仍归 `create-formal-verification-skill` 生成的 `formal-verify-*`。
4. 四个改写自 pstack 的验证 Skill 对齐到 `fbb86c09`：`create-verification-skill` 吸收“空数据目录可用、seed 不弱化 journey、替身环境步骤列为未验证”；`create-formal-verification-skill` 指向 `/statechart` 读 TLA+ 结果。

## Consequences

- 已有 Spec 的 Business Flow 有状态图时，重新运行 `check-spec.js` 会报 `state`，补 `Owns:` 行即可。
- `statechart` 首次运行需要 mise 安装 Java 与 TLC，要联网；没有 mise 时设 `TLA2TOOLS` 与 `JAVA`。
- Business Flow 用读者词，状态 id 需在 `state "…" as <id>` 里给出稳定 id，`Owns:` 行用 id。
