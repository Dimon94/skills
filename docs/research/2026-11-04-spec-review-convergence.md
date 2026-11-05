# 一个 Spec/MR 的 CodeReview 如何收敛

职责：只读调查与改进候选。日期：2026-11-04。未修改 Skill、执行正式 diff Review、建 Issue 或改变发布 gate。

## 结论

pstack 的关键区分是：**verdict 覆盖 patch，green CI 覆盖 head。新 head 要有适用的新结论，但不必从零重审所有已证行为。** 完整 swarm 在 code-ready head 执行；新增行为、重设计或大 diff 才再次完整执行。小修复、rebase、冲突解决交给单 verifier；纯措辞免 swarm。[P1] 这能解释一种收敛机制，不能证明用户的实际轮次或 CI 等待已经减少。

本地 `code-review` 允许复核受影响轴/范围，`gh-merge-pr` 则让旧 Packet 和结果随 head 失效。[L1][L2] 两者可以协调：重建新 Packet，由独立 reviewer 检查修复差异、邻接影响及证据适用性，再给 current-head verdict。**整份旧结论不能直接放行，不等于旧证据必须全部重做。** 缺少的是证据复用与新结论的明确协调规则，不能因此先认定逻辑矛盾或每次必定全量重跑。

## 机制对照：什么真的限制了重审

| 机制 | 实际源码合同 | 适用边界 |
| --- | --- | --- |
| 完整审查与修复复核 | Autopilot-full 区分 full swarm、单 verifier、纯措辞；Shipping 要独立于作者的用户入口验证。[P1][P2] | 免 full swarm 不等于免独立结论、必需检查或语义核对。不能把两个 playbook 的步骤直接相加成实际重复轮次。 |
| 证据延续 | Shipping 比较 verdict SHA 与当前 head 的 `git patch-id`；测试、文档、lint 差异下，特定 lane 还可凭构建等价保留。[P2] | 这是按 lane 复用；新改动仍要新 checks/review。无构建产物的 dev-server lane 不能证明等价，须重跑。 |
| comment 分流 | Bugbot 用 `fix / dismiss / ask`；dismiss 要有文档模式及当前反证，高风险不自动跳过。[P3] | `ask` 不等于已证明缺陷，也不是本文要求再问用户抽象规则；可先做有界取证，剩余产品/权限决定才升级。 |
| 发现项证明 | Interrogate 只保留实际运行证明、复跑后仍违背 intent 的问题，并合并同根因项。[P4] | 这是该 Skill 的窄合同。静态可证明的权限缺失、密钥外泄仍可阻断，不能要求先完成真实攻击。 |
| 测试规模 | TDD 优先廉价、最近的现有检查；拒绝为小修复建立脆弱 mock、庞大 fixture 或昂贵设施。[P5] | 不适合新增测试时仍需最近可执行验证；不等于免证据或削弱项目既有必需测试。 |

Google 的标准是改善整体 code health，而非完美；不重要的建议标 `Nit:`，作者可以忽略。但设计问题须依据工程原则判断，不能都叫风格。[E1] Gerrit 更直接展示“结论可复制”的平台语义：`copyCondition` 决定 approval 是否带到新 patch set，未复制的成为 outdated。`NO_CODE_CHANGE` 要相同 parent tree 和含上下文的 code diff，主要容许提交说明变化；`TRIVIAL_REBASE` 要相同提交说明与含上下文的 diff，允许无冲突换 parent。[E2] **它们不是“改了文档”与“运行效果不变”的同义词，也不证明新 base 上测试通过。**

## 变化分类：复用什么，必须重验什么

以下将上游机制与本地适用建议分开；“复用”都以独立 reviewer 核验有效性为前提。

| 变化 | 可复用的覆盖 | 新结论必须补足的证据 |
| --- | --- | --- |
| 小修复，行为范围不扩张 | 未受影响的需求与 lane | 修复 diff、原失败检查、相邻调用/错误路径；受影响审查轴重新结论。[P1][L1] |
| 新行为、重设计、大 diff | 仍相关的历史事实 | pstack 重跑 full swarm；本地重新确定受影响范围，不能沿用“只是修复”的标签。[P1] |
| 无冲突 rebase，patch 相同 | patch 的审查事实可候选延续 | 新 base 的依赖、调用方与运行结果；patch-id 相同不证明这些不变，新 head 仍要自己的 green CI。[P1][P2] |
| 冲突解决、双方改同文件、检查规则变化 | 未受影响部分 | 审查解决后的语义及实际合并结果，重验相关 gates；pstack 单 verifier 并非机械免 full，若产生新行为仍命中 full 条件。[P1] |
| base 改调用方、被调用代码或依赖版本 | patch 局部事实 | pstack 要在 merge result 跑 patch 的 checks；无关 trunk 移动不自动要求 rebase。[P1] |
| 双方改锁文件 | 不能只凭文本合并成功 | pstack 仅在 merge result 的 frozen install 成功、PR 所改包解析与 head 一致时允许免 rebase；否则 rebase 修复。依赖变更仍需相关行为验证。[P1] |
| 测试、lint、普通文档修改 | 产物等价且输入/环境适用的特定 lane | 修改本身的新 checks/review；改变测试选择或断言须防止假绿。[P2] |
| Spec、SKILL.md、协议/权限文案语义变化 | 未被新合同推翻的事实 | 重核受影响验收及调用方。文档语义会改变行为，不能归为 wording-only；错误的 shipped doc 本身也可阻断。[P1] |

Gerrit 的复制规则和 GitHub 的 stale approval 都是平台状态政策，不能代替上述风险判断。GitHub 可配置“diff 改变则撤销旧批准”，也支持保留其他旧批准、让最后一次 reviewable push 获另一人批准；strict required checks 则可能因 base 前进要求更多 build。[E3] 本次只解释能力，未建议关闭现有保护。

## comment 何时处理，何时停止扩张

判定须说明触发条件、影响、与本次变更关系和证据；概率低不自动免责，规则名字响亮也不自动阻断。

| 具体场景 | 建议处置与反例 |
| --- | --- |
| 罕见终端宽度导致非关键提示换行，核心结果仍可读，Spec 无该格式要求 | 可标 non-blocker/defer，记录已知限制。若机器输出协议被破坏或用户无法恢复，则应 fix；真实新回归不能随意叫噪声。 |
| 内部函数重复检查已由唯一边界解析器保证的非空值 | 用值来源与不变量 dismiss，无需为安静加 guard。若跨异步状态、绕过解析入口或身份变化，原反证失效，应查新边界。[P3][P6] |
| 建议换变量名或再抽 helper，但无规范依据与可观察维护影响 | 标 Nit/optional；有多种等价方案时接受作者选择。明确公共 Interface 误导调用方则须依据合同处理。[E1] |
| 新接口登录后直接按文件 ID 读取，未核租户归属 | 源码足以证明授权路径缺失即可 block/fix，不要求先攻击生产；低概率不抵消数据暴露影响。 |
| 重试退款可能二次出款，或新迁移删除仍被线上读的列 | fix，补针对幂等/部署顺序的证据；写 follow-up 不消除阻断。 |
| 扫描报高危依赖，但版本、可达性不清楚 | needs-evidence，查版本和调用路径；仅“没复现”不可 dismiss。尚未证实不写成确定缺陷；若重大相关风险未能排除，发布保持 blocked 并写恢复条件。 |
| base 原有错误，本次未修改、复制或新触达该路径 | 分离为既有问题；若新入口使它可达，就属于本次风险。[P1] 即便不是本次回归，必需 CI 失败或发布 gate 未满足仍不能放行。 |

同根因可以共享修复与复现，Standards/Spec 仍保留各自依据。第三轮只倾向排除已证明的低风险模式；pstack 自带第七轮发现文案契约真错的例子。[P3] 轮次不是缺陷证据，也不是停止条件。

## 测试怎样才算充分

“充分”针对当前 Spec、变化和具体错误实现：关键验收有可观察结果，新增风险有区分力，既有必需检查通过，剩余缺口明示。测试长度、数量和覆盖率只能提示成本，不能证明正确性。Quality Standards 的默认“1 主路径＋必要 1 关键失败”和“测试比实现长”不能成为必要性或充分性的硬定理；一行授权过滤，也可能合理需要匿名、同租户、跨租户和管理员等多身份检查。[L3]

本地 `test-review` 已明确：低价值未覆盖不自动 FAIL/Unknown；补测须说明高价值保护及现有覆盖不足；只有保护或替代覆盖有争议才做最小消融，不给每条测试追加运行；不按数量或覆盖率下结论。[L5] 因而可借鉴的是执行这些现有取舍，不能再造一套默认逐条消融、全分支补测的流程。

**最小示例（假设合同，未实际执行）：** 退款公开 Interface `POST /refunds` 接受租户身份、订单和幂等键；合同为同键只退款一次，跨租户拒绝且无副作用。

- 从 HTTP 入口对同租户同订单同键连续请求两次；断言返回同一退款 ID、持久退款只有一笔、外部支付边界只收到一次退款请求。它拒绝“每次都新建退款”和“响应复用但重复出款”的错误实现。用既有隔离支付替身观察外部边界，不 mock 幂等 helper 本身。
- 用另一租户请求该订单；断言拒绝且持久记录与支付请求均不增加。它拒绝“只认证、不授权”和“先出款后检查归属”。

这两个例子不证明并发安全。若本次接入并发重试，新增受控屏障让两次请求同时进入竞争窗口，验证仍仅一次副作用，是新风险；若退款金额换算也变了，金额精度也需对应检查。反过来，穷举所有内部 if 组合、mock 每层调用并断言调用顺序、用十个同义输入重复同一规则，未拒绝新的具体错误实现时属于低价值测试。不能为了凑两个测试掩盖独立风险，也不能为了覆盖分支新增无关 fixture。[P5][L3]

## 循环中哪些边必要

必要链是：真实 finding → 有因果依据的修复 → 原失败及受影响验证 → 新版本独立结论 → current-head CI 与实际发布 gate。可省的是每条 comment 各 push 一次、每个 trunk 移动都 rebase、每个小修复都完整 swarm、无新信息反复重跑 CI。pstack 将已知修复合成一波 push；fix rounds 留在同一 base，遇冲突、CI/base 问题或已知同文件并发变化才调整。[P1][P7]

本地存在条件式固定成本叠加：每票 `implement` 末尾一次 full suite 与双轴 review；常规集成交付另有 whole-change testing/review；经 `gh-merge-pr` 的 PR 再有 current-head 主审及命中专项。若三层均被调用，一票可经历这些不同范围的检查；独立票模式则跳过 whole-map gates。[L1][L2][L4] 源码能推导触发条件和调用层数，不能推导实际耗时、所有覆盖相同或某层必可删除。

**收口条件：** 当前 head 的 Spec/Standards 及命中专项有适用独立结论；所有本次交付 blocker 已解除；相关高影响未知已处置；必需 CI、讨论、mergeability 与发布 gate 均满足。否则说明 blocked 和恢复条件。真实 bug 持续修，不用固定两轮 PASS。[L1][L2][L4]

最小建议只落在现有 owner：每轮附修复 diff、finding ID、证据覆盖及失效范围，让 reviewer 生成新结论；comment 标清 fix、带反证 dismiss、可延后项或 needs-evidence；已知修复合并 push，按实际 base 影响决定重验。反例是只改“已审 head”字段、直接搬旧 PASS，或靠 patch-id 绕过新依赖风险，均不能接受。这里未制定新流程。

## 最小反例：报错位置不等于根因

这是本次实际执行的隔离机制检查，不是用户历史事故。基线与变更版使用相同的 consumer，只修改 provider 的公开行为。

基线 provider.py：

~~~python
def amount(cents):
    return cents
~~~

consumer.py 在两个版本中保持字节相同：

~~~python
from provider import amount

def verify_invoice():
    actual = amount(125)
    assert actual == 125, f"invoice expected 125 cents, got {actual}"

verify_invoice()
~~~

基线执行 `python3 -B consumer.py`，退出 0。只将 provider 的返回改为 `return cents * 100`，再执行同一命令，退出 1，失败为：

~~~text
AssertionError: invoice expected 125 cents, got 12500
~~~

父会话与独立研究会话均复跑得到上述结果。consumer 未修改、没有换 base，仍会因 provider 的本次改动失败。因此“失败文件不在 diff 中”不能推出“旧基线出错”；需要追到实际依赖和因果变化。探针在仓外执行，未修改目标项目源码。

## 相比最初报告，更精确与需纠正处

1. “head 变化使 Packet 失效”与“delta 复核”不必冲突；需要的是新 Packet/结论承接仍有效覆盖，不能把失效解释为所有事实作废。
2. patch-id 只帮助识别 patch 延续；特定 lane 的构建等价是另一项证据，二者均不证明新 base/依赖安全。Gerrit `NO_CODE_CHANGE` 更不是 docs-only。
3. Babysit step 7 明文将 diff 未触及代码中的失败归为 stale base；这不是可靠普遍规则。[P7] 父会话的隔离反例仅把 `provider.py` 的 `amount` 从返回 `cents` 改为 `cents * 100`，`consumer.py` 未变，检查却由 exit 0 变为 exit 1，报 `invoice expected 125 cents, got 12500`。[R1] 本次另在临时目录复跑两版本，得到同样结果并核对 consumer 字节相同。故 diff 外报错也可能由本次改动直接引起，必须查调用/依赖链和 base 对照；这是机制反例，不是用户真实事故。
4. 少触发 build 与加速一次 build 是两件事。CI 与 review 可能重叠，不能相加当墙钟等待。分层审查是潜在成本叠加，须看实际触发范围及时间线，不能一律删除。
5. 测试取舍并非本地空白：`test-review` 已有高价值优先、低价值未覆盖不自动阻断及争议时消融。不能从 Quality Standards 的数量/长度措辞推导“多于两例或比实现长就是错”。

**事实与 Unknown：** 七份 pstack 源码已逐字节对照固定 SHA；下列三项补充均为实际读取的第一方资料。以上能证明合同文字，不能证明模型执行率。本次没有实际 Spec/MR 多轮历史、目标 CI DAG 或 job 数据；哪些环节最耗时、重复测试比例及优化收益均为 Unknown。所谓“证据失效处理不清、噪声驱动修改、过频 rebase 可能放大成本”只是待验证推断，尚不能排序。后续宜由父会话用一个已结束 Spec/MR 的逐 head 记录核对，不先改规则。

## 来源与核验坐标

上游 pstack 固定 `cursor/plugins@180939f9e59cc9512e9330649175763e81fad16f`；本地 `my-skills` 基线 `88bbb4f5edd1bfd87453bed9820249389d5614ef`。本地引用为本次实际读取的工作区合同，未把既有 dirty 当本次结果。外部资料访问日均为 2026-11-04，未运行上游交付流程。

- [P1 Autopilot-full，第 5、10、14–20 行](https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/autopilot-full.md#L5-L20)：完整/增量验证、base、锁文件、current-head CI。
- [P2 Shipping，第 5–8 行](https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/shipping.md#L5-L8)：独立 verifier、patch-id、lane 构建等价及限制。
- [P3 Bugbot triage，第 7–13、54–84、98–122 行](https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/references/bugbot-triage.md#L7-L13)：处置、高风险排除、晚轮真实发现与过时安全 finding。
- [P4 Interrogate，第 9–23 行](https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/interrogate/SKILL.md#L9-L23)：运行证明、复跑与同根因合并。
- [P5 TDD，第 9–34 行](https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/tdd/SKILL.md#L9-L34)：聚焦回归、替代验证与拒绝坏测试。
- [P6 Boundary Discipline，第 9–24 行](https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/principle-boundary-discipline/SKILL.md#L9-L24)：边界集中校验；本文对授权/状态边界的限制是适用判断，非上游原句。
- [P7 Babysit，第 11、19–20 行](https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/babysit.md#L11-L20)：push wave、CI 归类、第三轮启发式。
- [E1 Google Engineering Practices / The Standard of Code Review，第 29–85 行](https://github.com/google/eng-practices/blob/3bb3ec25b3b0199f4940b1aa75f0ac5c5753301c/review/reviewer/standard.md#L29-L85)：改善而非完美、Nit、事实与偏好。
- [E2 Gerrit / config-labels，Sticky Votes 与 copyCondition](https://github.com/GerritCodeReview/gerrit/blob/6efbf2ff484e3c157db90362478273f53d78d44e/Documentation/config-labels.txt#L345-L437)：第 17–34 行定义复制/过期；第 378–427 行区分 NO_CODE_CHANGE 与 TRIVIAL_REBASE。实际项目配置可能不同。
- [E3 GitHub / About protected branches，第 81–109 行](https://github.com/github/docs/blob/4a20c763a48bd4f5a34a84c002fd9858e9793f65/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md#L81-L109)：批准重置、最后 push 审批及 strict/loose checks。
- [L1 code-review，第 81–109 行](/Users/dimon/01-Personal/10-Projects/my-skills/skills/code-review/SKILL.md:81)：受影响轴/范围与独立新结论；implementation/whole-change 基线不同。
- [L2 gh-merge-pr，第 20–30、68–79 行](/Users/dimon/01-Personal/10-Projects/my-skills/skills/gh-merge-pr/SKILL.md:20)：Packet 失效、主审与 current-head/provider gates。
- [L3 Quality Standards，第 24、28–33、66–78 行](/Users/dimon/01-Personal/10-Projects/my-skills/docs/agents/quality-standards.md:24)：P0–P3 未统一映射 blocker；`<stage>` 引用未在根 AGENTS 定义；已有反过度工程规则。
- [L4 ADR-0012，第 7、25–31 行](/Users/dimon/01-Personal/10-Projects/delivery-pipeline/docs/adr/0012-acceptance-circuit.md:7)：无硬轮次上限；[gate state machine](/Users/dimon/01-Personal/10-Projects/delivery-pipeline/skills/delivery-pipeline/references/gate-state-machine.md:24) 与 [test-decision-and-rebase](/Users/dimon/01-Personal/10-Projects/delivery-pipeline/skills/delivery-pipeline/references/test-decision-and-rebase.md:31) 区分 whole-change、rebase 最小复核、remote gate；[implement](/Users/dimon/.agents/skills/implement/SKILL.md:11) 要 full suite once 与 code-review。基线和意图不同，尚无证据证明这些层全部冗余。
- [L5 test-review，第 34–38、54–64、81–97 行](/Users/dimon/01-Personal/10-Projects/my-skills/skills/test-review/SKILL.md:34)：价值取舍、判别力、争议时消融与必要验证后停止扩大。
- **R1 本次隔离反例**：见本页“最小反例：报错位置不等于根因”。两会话各自复跑基线与变更版，退出为 0/1，consumer 字节相同。正文保留可重建输入和观测结果，不依赖临时目录作为持久来源。


[P1]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/autopilot-full.md#L5-L20
[P2]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/shipping.md#L5-L8
[P3]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/references/bugbot-triage.md#L7-L13
[P4]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/interrogate/SKILL.md#L9-L23
[P5]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/tdd/SKILL.md#L9-L34
[P6]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/principle-boundary-discipline/SKILL.md#L9-L24
[P7]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/babysit.md#L11-L20
[E1]: https://github.com/google/eng-practices/blob/3bb3ec25b3b0199f4940b1aa75f0ac5c5753301c/review/reviewer/standard.md#L29-L85
[E2]: https://github.com/GerritCodeReview/gerrit/blob/6efbf2ff484e3c157db90362478273f53d78d44e/Documentation/config-labels.txt
[E3]: https://github.com/github/docs/blob/4a20c763a48bd4f5a34a84c002fd9858e9793f65/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md#L81-L109
[L1]: ../../skills/code-review/SKILL.md
[L2]: ../../skills/gh-merge-pr/SKILL.md
[L3]: ../agents/quality-standards.md
[L4]: /Users/dimon/01-Personal/10-Projects/delivery-pipeline/docs/adr/0012-acceptance-circuit.md:7
[L5]: ../../skills/test-review/SKILL.md
[R1]: #最小反例报错位置不等于根因
