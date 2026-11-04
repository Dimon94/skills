# tdd 与 implement 转为本仓自有 Skill

Status: accepted

Related: repo://skills/tdd/SKILL.md；repo://skills/implement/SKILL.md；repo://docs/adr/0005-code-review-upstream-severity.md；repo://docs/research/2026-11-03-agent-tdd-industry.md；repo://docs/research/2026-11-03-agent-tdd-cross-domain.md

## Context

`~/.agents/skills/tdd` 与 `~/.agents/skills/implement` 原本链接到 mattpocock/skills。偏执行的模型按上游 `tdd` 工作时，常写出低价值测试：期望值抄自实现、断言弱到空实现也能通过。上游 `tdd` 默认每处都走红绿，并要求逐个 seam 找用户确认；上游 `implement` 最后调用 `code-review`，没有阻断线。

调研结论（见 Related 两份研究）：

- 一篇预印本中，只看任务描述、在新会话写的测试，故障检出率约 25%；看过故障代码后再写约 14%。基准与模型有局限。
- 主流方案共同缺少三点：期望值来源的独立性、跳过测试决定的可读理由、“能变红”与“断言正确”的区分。

2026-11-04 用户确认：

- 名称保持 `tdd` 与 `implement`，`implement-spec`、delivery-pipeline 等调用方不用改。
- 验收带具体例子与来源（独立预期），不新增文档或阶段。
- 测试层按缺陷位置分析，不一刀切。
- 探针真跑；第一期不建场景台账、跳过账本或随机审计。
- 只有 P0/P1 阻断，P2 由 implement 查重后发 issue。
- 不做前向验证，直接切换，之后迭代。

## Decision

### 1. 接管运行时名称

两个 Skill 放在本仓 `skills/`，经 repo://scripts/link-skills.sh 链入 agent 目录。repo://scripts/install-development-workflow.sh 不再把 `implement` 链到 mattpocock。来源登记在 adapted-sources.md，不进入快照锁定。

### 2. tdd 按需

`tdd` 先按改动类型分流：无行为变化不新写测试，缺陷先复现，行为未定先确认合同。每条检查要有独立预期，指不出来源就停下来问。层按缺陷藏在哪里选。seam 优先用 spec 指定的，否则选最高的现有公开入口，不再逐个找用户确认。新增检查要有 red、green 与真跑的探针记录。

### 3. implement 驱动真实运行，再审一轮

`implement` 在按切片调用 `tdd` 后，跑相关 E2E、命中覆盖记录的形式验证与全量测试，再调用一次 `code-review`。P0/P1 修复后按 `code-review` 的复审范围复核；P2 查重后发 issue，这一步的远程写入由 Skill 授权。

## Consequences

### 正面

- 期望值必须有来源，执行模型不能从实现反抄。
- 无行为变化的改动不再造测试。
- 审查只在 P0/P1 上循环。

### 负面 / 成本

- 不随上游自动同步，更新按 adapted-sources.md 人工对照。
- 切换前没有前向验证。新链路是否减少低价值测试为 Unknown，靠后续真实使用迭代。
- 近似错误探针增加运行时间；要重新构建的层只在高风险验收上跑。

### 边界

- 不裁决项目测试规范：项目规范与 `tdd` 冲突时项目规范优先。
- 不建场景台账、跳过账本或随机审计；真实发生 2 次选漏后再评估。
- 回退：把两个 symlink 指回 mattpocock 对应目录，恢复安装脚本中的 `implement`。
