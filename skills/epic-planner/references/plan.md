# 形成 epic-plan

只在 `SKILL.md` 的形成门槛全部满足后读取。汇总已验证的事实和已确认的取舍，不在收口阶段默默补做决定；发现新的史诗层问题就退回寻路。

## 1. 从代码与决定形成架构

读取 `codebase-design/SKILL.md`，沿用 Module、Interface、Depth、Seam、Adapter、Leverage、Locality。已有浅模块需要加深时再读其 `DEEPENING.md`。

从 investigate/research 的证据和 HITL resolution 中列出现有 Module、唯一状态 owner、public Interface、caller 与测试。优先复用现有 Interface；每个目标 Module 写清 owns、does not own、依赖与可观察行为。用 deletion test 检查 Depth，只有转发价值的层合并回最近 owner。

跨地图合同索引包含：Seam 位置、唯一 owner、provider/consumer、输入输出与错误/不变量/顺序的合同链接、已有实现或已决设计状态、共用验证样例及测试位置。涉及副作用时包含幂等、恢复与迁移决定。完整合同归源码或负责该决定的票；这里仅索引。

**完成条件：** 每条跨 Module 依赖都对应有证据的 Interface。新增 Seam 有真实变化或外部协议依据；共享身份、数据、权限和事务没有多个 owner。尚未实现的设计明确标识。

## 2. 形成多张候选地图

按独立决策空间组合 Module，产出至少两张候选。每张地图可以覆盖多个 Module；路线已清楚的部分直接归实施交接，不为凑数造地图。

每张候选卡包含：名称与价值、Destination 与完成标准、涉及的 Module 和共享合同指针、独有开放决定与 fog、范围外事项、输入/输出和 consumer、并发组及具名阻塞。

优先扩大可独立寻路的并发组。每条前置依赖必须指出需要哪个结果，避免机械串行。组内候选不裁决同一共享问题，也不争写同一状态；已决但未实现的合同可支持并发规划，实现证据另列。下游开放决定可以继续寻路，但不得重新假定尚未决定的共享语义。

**完成条件：** 各史诗成功标准都有候选或已有能力承接；各候选有独立 Destination。每组都能解释为何可并发，受阻项有明确解阻条件；不把并发规划当作并发实现。

## 3. 定义接合并发布

沿最小端到端路径写出 caller → provider → Interface → 可观察结果。指定集成 owner、接入顺序、一个主路径和一个关键失败路径的具体输入与预期，引用共享合同验证样例。涉及存量数据时链接已确认的迁移与回滚决定。

把计划作为远程史诗索引的最终 `epic-plan` 入口：架构、候选地图与集成验收按 [Issue 合同](issue-publication.md) 放置。依 [交接与续接](handoff.md) 给各候选生成远程提示词，读回链接后标记「规划就绪」。

**完成条件：** 另一会话仅凭远程索引和自己的候选入口即可开始 Wayfinder；集成 owner 能据合同判断后续成果能否接合。这里只交付验收计划，实际接合仍需实现后穿过真实 provider 验证。
