# Architecture Standards

Status: canonical architecture standard

用途：约束状态所有权、依赖方向，以及 module、interface、seam 和 adapter 的形状。本文件不替代 CONTEXT.md、System Map、最近的 AGENTS.md 或 accepted ADR。

## 1. 前置材料

先读：

1. repo://docs/agents/coding-standards.md。
2. repo://CONTEXT.md。
3. repo://docs/architecture/current-system-map.md。
4. 每个变更文件最近的 AGENTS.md。
5. 相关 accepted ADR 和外部合同。
6. 命中合同触发面时读取 repo://docs/agents/layer-contracts.md。

运行证据和真实持久状态优先。Accepted 合同、ADR 和最近 AGENTS.md 优先于本规范。

## 2. 固定词汇

| 词汇 | 含义 |
| --- | --- |
| Module | 具有一个 public interface 和一套 implementation 的能力单元。 |
| Interface | Caller 正确使用 module 必须知道的全部事实。 |
| Implementation | Module 内部实现。它不因测试需要自动公开。 |
| Ownership | 对规则或状态拥有唯一写权和最终解释权。 |
| Depth | Interface 为 caller 隐藏正确行为和复杂度的程度。 |
| Seam | 不编辑 caller 即可替换行为的位置。 |
| Adapter | 位于 seam 并翻译具体协议的实现。 |
| Leverage | Caller 学习少量 interface 即获得更多正确行为。 |
| Locality | 规则、修改、失败和验证集中在 owner。 |

## 3. Ownership Gates

每次架构检查先回答：

1. 哪个 module 拥有这条规则？
2. 哪个系统拥有这份状态的唯一写权？
3. UI、缓存、日志、搜索索引或 read model 是否形成第二真相？
4. 低层 owner 是否反向依赖 transport、UI 或投影层？
5. 外部副作用是否经过明确 seam？
6. Caller 是否绕过 public interface 导入内部实现？

Owner 为 Unknown 时，先把 Unknown 写进 System Map。不要用目录位置或现有调用次数猜所有权。

## 4. Module 设计

一个 module 必须说明：

- Owns：它拥有的规则和状态。
- Does not own：它明确不拥有的职责。
- Public interface：唯一调用入口。
- Dependencies：它读取的上游事实和外部 seam。
- Output：它写入的结果或证据。
- Verification：通过 interface 证明行为的测试。

无法回答时，不要先建目录、class 或 interface。先找最近 owner。

## 5. Deep Module

优先使用小而完整的 interface 隐藏 caller 不应重复知道的复杂度。

未解释的复杂度必须自证：问 helper、layer、特例或抽象被删除、内联、重命名或简化后会出现什么具体问题。答不出具体问题时，优先简单、自解释的代码和少量连贯抽象。

不要用代码行数衡量 depth。使用 deletion test：

- 删除后，规则、错误和恢复逻辑会散到多个 caller：module 提供 leverage，应保留或加深。
- 删除后只少一层命名转发：module 可能是 Middle Man。
- 删除后业务能力一起消失：继续检查 interface 是否真的小，ownership 是否集中。

## 6. Public Interface

- Caller 只从 public export 或 package 入口使用 module。
- Interface 只暴露 caller 必须知道的事实。
- 内部 test seam 不因测试方便进入 public interface。
- 同一规则只保留一个 canonical implementation。
- Compatibility shim 必须委托 canonical implementation，并有删除条件；无真实存量用户时不引入 shim，直接 clean-break。
- 评估公开 API 站在 caller 视角：可发现性、防误用、错误语义、配置面和演进路径。与本地约定不一致的行业通行做法做对照，有意偏离时说明理由。

## 7. Seam 与 Adapter

原则：一个 adapter 代表假想 seam；两个合理 adapter 才证明可替换 seam。外部协议隔离可单独证明 seam。

| 依赖类型 | 默认做法 |
| --- | --- |
| 进程内确定性逻辑 | 直接放入 owner。不为纯函数建 port。 |
| 本地可替换资源 | 使用内部 test seam。不要扩大 caller interface。 |
| 跨进程自有服务 | 在协议边界定义窄 interface。 |
| 外部系统 | Owner 接受外部 port。生产 adapter 与 fake 位于该 seam。 |

Adapter 只处理协议、鉴权、校验、序列化和错误映射。业务规则留在 owner。

## 8. Interface 就是测试面

- Caller 和主要行为测试穿过同一 public interface。
- 测试断言 observable outcome、错误和不变量。
- Transport adapter 测试只覆盖 transport 职责。
- Owner module 测试覆盖业务行为。
- 关键端到端测试证明层间合同。
- 不 mock 私有 helper 来证明公开行为。

## 9. 状态与副作用

- 计算 module 返回 typed result。明确 owner 执行持久写入和外部副作用。
- 读模型只投影，不反向拥有状态。
- UI 只消费后端或 owner 给出的资格和状态。它不重建业务规则。
- 写动作在执行点重新检查权限、身份和当前状态。
- 一致性要求决定事务、锁、lease、幂等和读回策略。
- 跨语言共识使用语言无关合同和 fixture。任一运行时的内部类型不能冒充跨系统唯一真相。

## 10. 明确拒绝

除非当前需求、真实 caller/adapter 和验证证据共同证明必要，默认不引入：

- 每个函数或类一个 interface。
- 单实现 registry、manager、facade、DI container 或 plugin system。
- 全仓通用 workflow DSL。
- 为未来集成或产品线预建抽象。
- UI 内的业务状态机和第二真相。
- 匿名 callback 隐藏持久写入或外部副作用。
- 按文件大小机械拆分。
- 活跃系统的 big-bang 重写。

## 11. Architecture Smells

| Smell | 诊断问题 |
| --- | --- |
| Parallel truth | 是否新增另一份身份、状态、权限或资格？ |
| Wrong owner | UI、route、adapter 或模型是否裁决了 owner 规则？ |
| Shallow module | Interface 是否几乎等于 implementation？ |
| Leaky interface | Caller 是否知道内部路径、payload 或协议细节？ |
| Hypothetical seam | 是否只有一个实现却新增 port/factory？ |
| Shotgun surgery | 一条规则变化是否要求多个 caller 同步修改？ |
| Divergent module | 一个 module 是否因多个无关原因变化？ |
| Circular dependency | 低层 owner 是否反向依赖高层？ |
| Compatibility fork | Shim 是否形成第二实现或没有删除条件？ |
| Test past interface | 测试是否必须穿过私有实现？ |
| Contract drift | 代码事实和 L1-L6 合同是否不一致？ |

## 12. 演进与 ADR

- 难回退、无上下文会意外或存在真实取舍的决定写 ADR。
- 公开 API、CLI、持久 schema、用户数据和外部合同不能静默破坏。
- 破坏性变化先定义迁移、回滚和验证。
- 迁移使用可端到端验证的垂直切片。
- 每个阶段只有一个当前 owner。避免长期双写。
- System Map 只写当前状态。目标状态需明确标记为 proposed。

## 13. Checklist

- [ ] Ownership gates 已逐项检查。
- [ ] Module 的 owns、does not own、interface 和测试面清楚。
- [ ] Interface 小而完整，没有泄漏 implementation。
- [ ] Deletion test 证明 module 提供 leverage。
- [ ] Seam 真实，adapter 保持协议翻译职责。
- [ ] 状态只有一个 canonical owner。
- [ ] 失败、恢复、并发和副作用由 owner 处理。
- [ ] 测试穿过 interface。
- [ ] 公开合同有迁移和回滚计划。
- [ ] 命中的 L1-L6 已完成文档回环。
