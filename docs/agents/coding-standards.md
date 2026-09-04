# Coding Standards

Status: canonical coding standard

用途：约束当前变更的局部正确性、清晰度、类型、错误、副作用和测试。所有权和依赖方向由 repo://docs/agents/architecture-standards.md 约束。

## 1. 适用范围与优先级

本规范适用于新增或修改的应用代码、脚本、配置和测试。第三方代码、生成产物和冻结样本按最近的 AGENTS.md 处理。

规则强度：

- MUST：违反会破坏正确性、安全、持久状态、外部合同或恢复能力。
- SHOULD：默认执行。偏离时提供当前需求、测试或合同证据。
- HEURISTIC：坏味道信号。必须结合具体代码和扩散风险判断。

冲突优先级：

1. 运行证据和真实持久状态。
2. accepted 外部合同、ADR 和最近的 AGENTS.md。
3. Architecture Standards。
4. 本规范。
5. 通用经验。

规范只约束当前变更和会阻断当前正确性的既有问题。

## 2. 第一原则：最少实体

如无必要，不新增 helper、class、type、schema、adapter、registry、manager、facade、config、feature flag 或文档规则。

新增前依次检查：

1. 最近 caller、同目录 helper 和现有 module pattern。
2. public export、共享 type/schema、脚本和合同。
3. 标准库、运行时原生能力和已安装依赖。
4. 前三层不适用时，才写最少新代码。

搜索键：相同业务词和状态名、相同错误语义、相同外部协议或持久写入、相同测试形状。

每个新增实体必须有当前需求职责。以下理由不能单独证明必要性：

- 以后可能复用。
- 方便 mock。
- 看起来更符合模式。
- 文件较长。
- 其他项目这样做。

DRY、SOLID、KISS 和 YAGNI 用来减少重复意义、特殊情况和无效间接层。它们不授权预建扩展点。

## 3. 命名与语言

- 使用 repo://CONTEXT.md 的 canonical term。
- 名称表达保存的事实或执行的动作。
- 身份、展示名、外部 ID 和内部引用使用不同类型或明确后缀。
- 布尔名表达可判定事实。避免 status、data、item、handle 等无边界名称。
- 单位进入名称或类型。时间、金额、容量和百分比不能依赖猜测。

## 4. 函数与控制流

- 一个函数承担一个可命名职责。
- 读取、裁决、外部副作用、持久写入和响应塑形混在一起时，先检查 owner 是否混杂。
- 优先 guard clause、明确状态分支和现有 helper。
- 三层以上缩进、重复 switch 和跨文件同步分支是复查信号。
- 文件大小只作信号。拆分必须提升 locality，并通过 deletion test。
- 确定性转换、路由、重试和状态迁移由代码完成。

## 5. 类型、输入与 schema

- 不可信输入在 transport 或持久化 seam 解析一次。
- 解析后的 typed value 进入内部 module。Caller 不重复猜字段。
- 执行动作前，owner 仍需重查权限、身份、当前状态和业务不变量。
- Schema 用于跨进程、跨语言、外部输入、持久数据或有污染风险的边界。
- 同一合同只有一个 canonical type/schema owner。
- 禁止用 Any、any、unchecked cast、宽松 coercion 或双重断言绕过关键校验。
- 互斥状态优先用可判别联合或明确状态类型表达。

## 6. 错误与日志

- 错误在 owner module 形成稳定、可测试的语义。
- 捕获具体错误。缩小 try 范围。
- 只有在能够恢复、补充稳定上下文或翻译 interface 错误时才捕获。
- 重新抛出时保留原始因果。
- 失败语义 fail-close：达不到成功标准的操作明确失败。默认值、缓存旧值和降级结果冒充成功是隐藏失败，不是恢复。
- 每个 catch、fallback 和默认值分支点名它防的真实失败场景；“以防万一”和“更安全”不成立，答不出来的删除。
- 身份、权限、安全、金额和持久状态失败时拒绝默认动作。
- 每个 blocked 或失败结果给出自然恢复动作。
- Transport 成功不等于业务成功。调用方还需断言业务 outcome。
- 面向用户的错误信息文本要求见 repo://docs/agents/writing-standards.md 第 3 节。
- 日志只作证，不拥有状态。
- 日志不得包含 secret、token、完整敏感 payload 或用户隐私。

## 7. 副作用、并发与恢复

- 副作用集中到明确 owning module。
- 只读路径不顺带修改持久状态。
- 重试、超时、并发、速率、幂等和取消策略具名表达。
- 影响成本、容量或恢复的默认值必须有 L5 合同和测试。
- 不用 sleep、固定轮询次数或进程内布尔值伪装 durable state。
- 幂等不能替代正常调度和并发控制。
- 需要原子性的写入必须使用数据库事务、原子替换、锁或同等受验证机制。

## 8. 注释与文档

- 优先自解释的代码：用清晰名称和结构表达意图；注释只补充代码无法表达的内容。
- 注释保持简短。注释中任何可以从代码推导出的断言一律删除。
- 注释只记录非显然不变量、假设、取舍理由、安全约束、外部系统怪癖和失败教训，不复述代码行为。
- 注释、标题和交付说明只描述当前行为。被放弃的方案、会话上下文和已修正的范围归 git history 与评审讨论。
- 保留的每条注释必须与所描述代码同步更新；发现过时注释即修正或删除。
- Doc comment 只用于公开 API，且仅在行为非显然或名称与签名无法表达合同时添加。
- 公开 API 文档描述可观察合同，不记录偶然实现细节。
- L3-L6 注释只在 Layer Contracts 的触发面使用。
- 文档引用使用 repo:// 坐标。
- CLI/诊断输出、错误信息、README/docs 与生成交付物的写作规则见 repo://docs/agents/writing-standards.md。
- Unknown 保持 Unknown。不要把猜想写入合同。

## 9. 测试

- 非琐碎逻辑至少有一个错误实现会失败的检查。
- 缺陷修复锁定根因或共享 public seam。
- 测试主要穿过 module 的 public interface。
- 断言可观察结果、失败语义和不变量。
- Adapter 测试证明 transport、鉴权、校验和错误映射。Owner 测试证明业务行为。
- 测试不为方便而扩大 public surface。
- 外部网络、付费服务和生产数据默认使用 fake、fixture 或隔离环境。
- 时间、随机数和 ID 只有在成为可观察输入时才注入或固定。
- Snapshot 不能替代关键字段和状态断言。
- 同义反复测试有害：测试不得只复述实现、断言 mock 自身的设定或断言恒真条件。每个断言必须能被至少一个错误实现推翻。

## 10. 技术栈规则

当前技术栈：纯 Markdown skill 与契约脚本（bash、Node.js），无构建、无框架、无运行时依赖。规则以 repo://skills/*/SKILL.md 与仓库文件本身为真相。

- Markdown 是交付物：结构、frontmatter 与指针的约束归 repo://docs/agents/writing-standards.md 与 repo://skills/* 自身。
- 脚本用仓库已有的 shell 与 Node 运行时，不引入依赖管理。

## 11. 坏味道

以下为 HEURISTIC：

| Smell | 检查问题 |
| --- | --- |
| Mysterious Name | 名称是否隐藏身份、单位、owner 或状态？ |
| Duplicated Code | 是否复制同一规则和失败语义，而非仅语法相似？ |
| Feature Envy | 逻辑是否持续读取另一 module 的内部数据？ |
| Data Clumps | 同组字段是否反复一起传递，并已有领域概念？ |
| Primitive Obsession | string/number 是否冒充身份、金额、时长或状态？ |
| Repeated Switches | 同一分支规则是否散落多个 caller？ |
| Speculative Generality | 是否新增当前需求不需要的配置、hook 或 interface？ |
| Message Chains | Caller 是否了解过多内部导航？ |
| Middle Man | 删除转发层后复杂度是否不会扩散？ |

## 12. Checklist

- [ ] 当前变更是满足需求的最小实现。
- [ ] 每个新增实体均有必要性证据。
- [ ] 使用统一语言和明确单位。
- [ ] 外部输入只在 seam 解析，owner 重查业务不变量。
- [ ] 失败语义 fail-close：错误显式、稳定、可测试，catch 和 fallback 点名真实失败场景。
- [ ] 副作用和状态由明确 owner 管理。
- [ ] 注释和公开 API 文档满足第 8 节。
- [ ] 测试穿过 public interface，并会在错误实现下失败。
- [ ] 没有引入平行机制或假想扩展点。
- [ ] 已继续执行 Architecture Standards 审核。
