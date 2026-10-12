# 票型与结论

建票时按问题分类；处理时读类型标签。每张票只解决一个能在单会话中推进的问题，过大的问题拆成有明确前提的决定，不按代码层拆成实施工单。

票涉及 Module、Interface 或 Seam 设计时，先读取 `codebase-design/SKILL.md`，按其词汇与 Depth 原则分析；委派时一起传递该指针。

## 路由

| 类型标签 | 模式 | 触发问题与 Skill | 解决条件 |
| --- | --- | --- | --- |
| `epic:investigate` | AFK | 仓内代码、历史、当前 Interface、Ownership 或测试事实；读取本仓 [investigate](../../investigate/SKILL.md) | 有代码/测试/历史坐标、事实与缺口，足以回答票面问题；推荐与已决取舍分开 |
| `epic:research` | AFK | 外部协议、依赖、官方文档或工作目录之外的知识；读取 `research/SKILL.md`，交后台 agent 查一手来源 | 每个关键结论有来源，版本适用性和未验证项明确，回答票面问题 |
| `epic:prototype` | HITL | 需要具体原型才能判断行为、状态或外观；读取 `prototype/SKILL.md` 并选择其逻辑或 UI 分支 | 原型可审阅，有真实用户反馈，记录它验证或否定的假设与设计决定 |
| `epic:grilling` | HITL | 目标、术语、拆分或方案取舍；读取 `grill-with-docs/SKILL.md`，依其路由使用 grilling 与 domain-modeling | 本轮可问的设计树问题已回答，用户确认理解一致，术语与决定有远程记录 |
| `epic:task` | AFK 或 HITL | 决策前必须先完成的动作，例如取得测试环境访问；agent 可做则 AFK，否则给用户精确清单 | 前置动作完成并有事实证据，解除了具名决策的阻塞；不承担产品交付 |

一张票需要新的前置事实时，把事实交给 investigate 或 research 票并连阻塞；不让用户猜可查事实。需要用户取舍时开 grilling 票，研究结论不能冒充用户答复。只创建本史诗实际需要的票型，不凑齐表格。

地图拆分本身是一张后期 grilling 票。先解决会改变边界的目标、业务语义、现有能力和外部约束；以这些 resolution 作为前置依赖，再用 codebase-design 比较拆分方案，与用户裁决 Ownership、共享 Interface 和可并发关系。方案只在该票内作为待裁决选项；用户确认并结案后才成为 epic-plan 的候选地图。发现仍缺战略前提时，回到取证或拷问，保持拆分票 blocked。

`task` 票在票面注明 AFK 或 HITL，按前置动作是否需要人来完成判定。

## 远程产物覆盖

每次调用或委派上表 Skill 时，把以下约束一起传入，覆盖它们写本地笔记、改产品代码或提交原型的默认动作：

- 结论、引用、术语和 ADR 提案写入当前票的评论；最终 resolution 是该决定的 canonical source。索引和计划只引用它，不另写本地报告、GLOSSARY.md 或 ADR 文件。
- 内部调研保持只读。外部研究的 Markdown 直接作为评论正文；后台 agent 返回票与证据链接。
- 原型在仓外临时沙箱或远程沙箱运行，产品 checkout 保持只读。可复查产物上传至项目允许的远程附件或原型位置，票内留链接；读回后清理本次临时材料。远程保存不可用时票保持未完成，不以本地路径作为交付。原型决定不自动写入产品代码、commit 或 push。
- HITL 的用户意见和确认须来自真实交互；无人答复时记录待回复内容，保持票 open。失去会话时按 tracker 的 claim 规则留下可恢复等待点。

## 票面与 resolution

```markdown
## Question
<一个待解决的问题，以及回答后能解开什么决定>

## Resolution criteria
<什么证据或真实用户确认足以解决本票>
```

索引归属、类型标签、claim 与 blocking 按 [Issue 合同](issue-publication.md) 表达。票面保存问题，答案写 resolution comment：结论、关键证据或用户确认、影响的 Module/Interface、仍待解决的问题及去向。然后读回、关闭并交回索引指针。

回答不能达到解决条件时，保持 open 并记录具体缺口；发现新问题时让它成为新票或「待明确」，不要把 Unknown 藏进结案措辞。
