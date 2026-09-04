# Architecture Decision Records

本目录保存难回退、有真实取舍或跨模块影响的架构决定。

普通实现选择由代码、测试和最近的 AGENTS.md 说明。不要为局部变量、普通 helper 或格式调整创建 ADR。

## 命名

使用四位编号和短标题：

    0001-short-decision-title.md

## 模板

    # 决定标题（不带 ADR 编号前缀）

    Status: proposed | accepted | superseded | rejected

    Related: #issue、其他 ADR 编号、repo:// 证据链接

    ## Context

    写已确认事实、约束和问题。未知项写 Unknown，并写清已锁定的事实锚点。

    ## Decision

    用编号小节（### 1. ### 2.）逐条写选择和边界，使用可验证陈述。
    被否决的替代方案及理由写在对应小节内，不单列 Alternatives 节。

    ## Consequences

    ### 正面
    ### 负面 / 成本
    ### 边界

    写收益、成本，以及本 ADR 冻结什么、不裁决什么（归后续票据）、
    什么前提下否决是终审、什么变化需要立新 ADR supersede 本记录。

证据（调研、spike、实测）以 `repo://` 链接内联引用，不单列 Verification 节。

若提案与 accepted ADR 冲突，明确指出冲突、证据和重开决定的理由，不静默覆盖。修改 accepted ADR 时保留历史：新建 ADR 并把旧记录标为 superseded。
