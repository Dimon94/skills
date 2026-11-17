# to-tickets 迁入本仓，合同先行切票

Status: accepted

Related: repo://skills/to-tickets/SKILL.md；repo://skills/to-tickets/scripts/check-tickets.js；repo://skills/ticket-sizing/SKILL.md；repo://docs/adr/0017-owned-ticket-sizing.md；repo://docs/adr/0015-mmf-delivery-unit.md

## Context

切票链原为 `vertical-slicing` → `ticket-sizing` → `ticket-split-100k` → `to-tickets`。`to-tickets` 是 mattpocock 上游原样链接，第 3、4 步再切一次片、再问一次用户，与 `vertical-slicing` 重复；单票时 `vertical-slicing` 短路到 `/implement`，而 delivery-pipeline 的 gate 要求单票也有 ticket 证据。MMF 切分测试、「同文件不是依赖」、波次规则在三个 Skill 各写一遍。

回放两份历史 Spec 的拆票（DD-455 16 票、DD-540 5 票）发现：walking skeleton 先行让第 1 波只有骨架，其余票排在它后面；R 写在多数票上而无唯一 owner（DD-455 的 R11 在 14 张票上）；同波 6 张票都改同一个 HostCommand 枚举；票正文 35–50% 复制 Spec。依赖只在原生关系里，派发方读的 `Blocked by:` 行缺失。用户要求票能并发开发、节奏稳定、开发后完全符合 Spec。

## Decision

### 1. 本仓拥有 to-tickets，合并上下游

`to-tickets` 成为本仓自有 Skill，吸收 `vertical-slicing` 的切分方法、例外模式与拆法库；`ticket-split-100k` 的拆分线与拆分步骤并入 `ticket-sizing`「拆分线」节。删除两个旧 Skill，安装器不再链接上游 `to-tickets`。链路变为 `to-epic` → `to-spec` → `to-tickets` → `implement`。单票也走 `to-tickets`，切片表只有一行。这是所有权转移，不写入 `sources.json`。

### 2. 合同先行，Owns 唯一

第 1 波是一张合同票：Interface 签名、共享写入目标的全部变体、桩与验收夹具，不实现行为。Spec 每条 T 和 R 恰好由一张行为票 `Owns`，其他票写 `Respects`。依赖边只有两种：依赖合同，或验收必须先有另一张票的行为。不设集成或回归票；整体验收归 MR 的 code-review Spec 轴。

否决 walking skeleton 先行：它把关键路径的第一跳变成实现行为的大票，并发要等它合入。否决按 Module 横切：票不再能单独检查。

### 3. 确定性核对归脚本

`scripts/check-tickets.js` 校验 T/R 唯一归属、Story 覆盖、合同票形状、依赖边存在与无环、票面 token 数字，并输出同波共享 Module 警告、波次与关键路径。模型只做切分与判断。DD-455 回放（夹具在 repo://skills/to-tickets/tests/fixtures/）：旧拆票 7 波、34 条归属错误、8 处同波重叠；合同先行 6 波、零错误、1 处重叠。关键路径只少一跳，因为会话到回合的链是 Spec 固有依赖；主要收益在冲突与归属。新的 R 与 Story 分配属于推断，只证明脚本规则，不证明真实执行节奏。

### 4. 调用方式不变

`to-tickets` 仍由用户调用（2170828f）。批准后是否自动串联下一步尚未决定，另行 ADR。

## Consequences

### 正面

切票规则只有一个 owner；重复规则删除；票面只指向 Spec，不复制；并发与覆盖由脚本证明。

### 负面 / 成本

合同票需要在开工前想清签名，Interface 形状答不上来时要先做 spike。delivery-pipeline 的 gate-state-machine.md 仍引用 `vertical-slicing` 与 `ticket-split-100k`，需在该仓配套修改。运行时 `to-tickets` 链接需从 Magpie 库改指本仓。

### 回滚

撤销本仓迁移提交，重跑安装器恢复上游 `to-tickets` 链接，并读回运行时链接真实路径；delivery-pipeline 的配套修改成对撤销。
