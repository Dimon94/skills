# ticket-sizing 所有权迁入本仓

Status: accepted

Related: repo://skills/ticket-sizing/SKILL.md；repo://skills/vertical-slicing/SKILL.md；repo://scripts/install-development-workflow.sh；delivery-pipeline ADR-0024

## Context

`ticket-sizing` 的主要调用方 `vertical-slicing`、`ticket-split-100k` 与 `dimon-mode` 都在本仓。
它原由 delivery-pipeline 拥有；该仓在 5ecd9ce 将它移出交付链路，并以 `OFF_CHAIN_OWNERS` 保留派发边界。
用户确认转移所有权，使只安装本仓即可取得完整的切票 Skill。
迁移基于 delivery-pipeline 的 5ebf537d6f9437dbce9ff254ac5f7eff6646b88c。

## Decision

### 1. 本仓成为唯一 owner

完整迁入 `ticket-sizing`，包括 `agents/openai.yaml`。行为保持不变；仅将两处原本反向引用交付链路的指针，
分别改为本仓 `vertical-slicing` 的「切分 MMF」合同与 `GLOSSARY.md` 的 MMF 词条。
安装器通过本仓 Skill 枚举链接它，不再从 delivery-pipeline 安装。

这是所有权转移，不是第三方上游快照，也不是保留外部行为 owner 的改写。
因此不写入 `sources.json` 或 `adapted-sources.md`；迁移来源由本 ADR 和 Git 历史保存。

### 2. delivery-pipeline 消费运行时 Skill

配套删除原目录、安装链接与本仓路径校验；交付链路按名称解析运行时 `ticket-sizing` 的绝对路径。
清理旧安装的逻辑也不再处理该名字，避免跨 owner 改写链接。
`OFF_CHAIN_OWNERS` 与配置里的 `ticket-sizing` 工作类型保持不变；来源见该仓 ADR-0024。

### 3. 回滚按 owner 成对执行

需要回滚时先撤销 delivery-pipeline 的配套迁移提交，恢复其 Skill 与安装入口；再撤销本仓迁移提交。
运行原 owner 的安装器恢复链接，并读回两个运行时链接的真实路径。
两仓必须成对回滚，避免没有 owner 或同时维护两份。Magpie 管理的来源需另行同步，不由本次迁移修改。

## Consequences

### 正面

切票规则与主要调用方由同一仓拥有；`ticket-sizing` 不再反向依赖 delivery-pipeline 的文件。

### 负面 / 成本

既有运行时链接需迁到本仓。Magpie 若仍登记旧来源，可能重新覆盖链接；其持久配置需由用户处理。

### 边界

本决定只迁移所有权与引用，不改变逐票预测、拆分信号、用户裁决或发布规则。
不引入兼容副本，不更改 worker 配置 schema，也不授权远程写入。
