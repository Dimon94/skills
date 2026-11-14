# automate-me 成为通用的个人工作方式 Skill 生成器

Status: accepted

Related: ADR 0010、0013；repo://skills/automate-me/SKILL.md；repo://skills/sync-upstream-skills/references/adapted-sources.md

## Context

pstack 的 `automate-me` 能从历史会话创建或更新个人 `-mode`，而 `poteto-mode` 只是上游作者本人的运行时入口。本仓已有 `dimon-mode`、写作规范和 Skill 编写 playbook，但没有跨会话证据采集与增量更新 owner。

使用者不仅需要迭代 `dimon-mode`，还需要让其他使用者在本仓创建各自的 `<handle>-mode`。因此，目标不是一个只服务 Dimon 的剧本分支，也不是把整个 pstack 工作方式当作快照引入。

## Decision

### 1. 生成器与个人产物分离

新增本仓自有的 `skills/automate-me`，拥有跨会话证据采集、偏好校准、创建和增量更新流程。`<handle>-mode` 是目标项目与目标使用者拥有的独立 Skill；`dimon-mode` 只是其中一个实例。生成器不保存任何人的具体偏好，也不让其他使用者依赖 `dimon-mode`。

否决只扩展现有 authoring playbook：那会混淆通用 Skill 写作与个人偏好画像，也无法独立表达跨会话增量语义。否决上游快照：本仓需要调整宿主边界、证据门槛和授权规则。

### 2. 只固化有证据的个人偏好

单次反馈保持候选；多个独立时间片重复才能提升为规则。只读取当前工作区可访问的历史；跨会话工具不可用时明确停下并请求证据。更新时以目标 mode 的上次变更为锚点，保留未被新证据推翻的段落。

项目规则、任务或项目 Skill 和已有 Skill 正文不进入个人 mode。现有 Skill 只通过指针复用，避免第二份行为真相。

### 3. 复用现有合同，不引入新框架

写作和 invocation 选择继续归 `writing-for-agents`；会话教训归 `retro`，仓库重复错误归 `correct`，具体写作与项目校验归目标项目规则。`automate-me` 是 user-invoked，路由只提示 `/automate-me`，不自动触发。

只交付 SKILL.md、显式调用元数据和两个隔离前向场景；不引入 Cursor 专属会话路径、固定 PR 收尾、额外脚本或依赖。

## Consequences

### 正面

- 同一生成器可服务多个使用者，个人偏好仍各有唯一 owner。
- 增量更新保护已有有效决定，新证据有来源和适用分支。
- 现有 Skill 与生成器之间保持指针关系，没有复制流程。

### 负面 / 成本

- 可用的跨会话历史取决于宿主能力；无法访问时创建和更新会等待用户补证据。
- 前向场景验证流程行为，不能保证主观偏好已经符合使用者期望。

### 边界

本 ADR 不裁决具体使用者的个人规则、`grill-with-docs` 的路由缺口或运行时安装。新增 Skill 合回 main 后仍按现有链接脚本安装；需要改变生成器与个人产物的所有权时，新建 ADR。
