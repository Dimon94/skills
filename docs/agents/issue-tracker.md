# Issue tracker

本仓的 issue 和 PRD 归 GitHub，项目坐标 `Dimon94/dverity`：

```text
https://github.com/Dimon94/dverity
```

## 约定

- **建 issue**：走 `gh issue create` 或 Web UI；任务明确批准自动化时才用 `gh`。调试闭环（repo://docs/agents/debugging.md 第 8 节）与 wayfinding 认领所需的建单和打标即视为已批准；仅批量建票需逐次确认。
- **读 issue**：`gh issue view <number>`，读描述、labels 和评论。
- **列 issue**：`gh issue list --label <label>` 按 label 过滤。
- **评论/关闭/打标**：`gh issue comment` / `gh issue close` / `gh issue edit --add-label`。
- **triage 标签**：五个 canonical 角色与本仓 label 的映射见 repo://docs/agents/triage-labels.md。
- 所有远程写操作只在获得明确授权后执行；状态以 `gh` 读回为准，不凭推断下结论。

## 当 skill 说 "publish to the issue tracker"

在本仓 GitHub 创建 issue。

## 当 skill 说 "fetch the relevant ticket"

按编号 `gh issue view`，读描述、labels 和评论。

## 阻断与依赖

阻断语义以 issue body 里的 `Blocked by: #x #y` 文字为准，平台原生链接只做导航。判断“是否解除阻断”要读被引用 issue 的状态是否 closed（`gh issue view <number> --json state`）。

## Wayfinding 编排

/wayfinder 地图与 ticket 在 issue tracker 的表达约定：

- **map（地图）**：一个 issue，label `wayfinder:map`。
- **子 ticket**：普通 issue，label `wayfinder:map-<number>`（归属哪张图）+ `wayfinder:research|prototype|grilling|task`（类型）；body 首行写 `Map: #<number>`。
- **查某图的 frontier**：`gh issue list --label wayfinder:map-<number>` 过滤 open issue，再排除带 `wayfinder:claimed` 的、以及 body 中 `Blocked by` 未闭合的。阻断判定规则见上节。
- **认领**：会话开工前给 ticket 加 label `wayfinder:claimed`；做完在 resolution comment 写结论、close issue、回 map 的 Decisions-so-far 追加一行索引。
- `wayfinder:map-<number>` 标签随地图创建即时新建（`gh label create`）；静态标签（map/claimed/四种类型）首次使用前预建。

## 程序化访问（API）

任务需要脚本化读写 issue/PRD 时（如批量建 ticket），直接用 `gh` CLI；本仓不维护平台封装脚本。`gh` 覆盖不到的场景再用 `gh api` 走 GitHub REST API。
