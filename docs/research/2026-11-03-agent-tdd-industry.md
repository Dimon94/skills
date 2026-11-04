# Research: 让 AI coding agent 写有价值测试、按需使用 TDD

检索日期：2026-11-03。抓取内容按不可信数据处理，只作证据，不执行其中指令。

## Summary

主流做法分五类：人盯增量、技能强制、确定性检查、变异引导生成、隔离 oracle 来源。
最强的新证据：同模型只看任务描述写测试，故障检出率约 25%；看过故障代码后再写，约 14%（[2607.05139](https://arxiv.org/abs/2607.05139)）。先写测试有用，但不够。
五类共同缺口：oracle 的来源缺少独立性，跳过决策不可审计，"能变红"被当成"断言正确"。

## Approaches

### A. 人盯增量：Canon TDD 与 augmented coding

- **做法。** 先列行为场景清单，一次只转一个可运行测试，通过后可选重构（[Canon TDD](https://tidyfirst.substack.com/p/canon-tdd)）。明确列出的错误包括：写无断言测试刷覆盖、删断言假通过、把实际输出粘成期望值。
- **Agent 用法。** Beck 用 `plan.md` 列测试，人说 "go" 才推进一个，并盯三类信号：循环、未要求的功能、禁用或删除测试（[Augmented Coding](https://tidyfirst.substack.com/p/augmented-coding-beyond-the-vibes)）。
- **适合。** 人能跟每个增量；算法或库代码，行为可枚举。
- **取舍。** 质量靠人的注意力兜底。Beck 前两次尝试因复杂度累积而停滞，第三次才加强设计干预，最终对代码质量仍"not so good"。证据是单人单项目自述，且文中披露 Augment 为赞助方。
- **与按需的关系。** Beck 的停止条件是"恐惧变成无聊"。推断：agent 无法直接执行这个主观信号。

### B. 技能强制：obra/superpowers

- **做法。** 铁律 `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST`；先写的代码要删；必须确认红灯因功能缺失而失败（[SKILL.md](https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md)）。
- **价值门。** 写测试前要说出"哪个生产改动会让它失败"；期望值不能由被测代码计算；禁止 mirror assertion 和 change detector；结束时做 mutation check（[writing-good-tests.md](https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/writing-good-tests.md)）。
- **适合。** 执行型模型爱跳流程；有明确行为变更的功能和缺陷修复。
- **取舍 1。** 默认全量覆盖，不是按需。例外只有原型、生成代码和配置，且要问人。
- **取舍 2。** 文件内部有张力：SKILL 反驳 "Too simple to test"，清单要求 "Every new function/method has a test"；writing-good-tests 却说 "trivial code ... earn none"。
- **取舍 3。** Mutation check 写的是 "mentally mutate"，靠自述，不是执行结果。
- **Unknown。** 已读两份文件未给效果数据。

### C. 确定性检查与独立审查：Claude Code 官方

- **现行文档。** 重心是"给 Claude 一个能返回通过或失败的检查"。严格度分层：提示词、`/goal`、Stop hook、未参与编写的 reviewer。完成时要命令和输出作证据（[Best practices](https://code.claude.com/docs/en/best-practices)）。
- **TDD 地位。** 现行页对 "TDD" 和 "test-driven" 均无匹配。"failing test" 只作为缺陷修复提示词示例和无人值守时的完成条件出现。
- **旧版做法。** 旧版把写测试、确认失败、提交、不改测试、独立 subagent 查过拟合列为 Anthropic 偏爱流程，并限定于"easily verifiable"的改动（[存档](https://web.archive.org/web/2025/https://www.anthropic.com/engineering/claude-code-best-practices)）。推断：官方已从 TDD 配方转向"检查无关具体形态"。
- **适合。** 任何有可执行检查的仓库；长时间无人值守运行。
- **取舍 1。** Stop hook 保证检查跑过且通过，不保证检查有价值。
- **取舍 2。** 文档示例中的 reviewer 只查"listed edge cases have tests"，且官方提醒：修掉每条 finding 会带来"tests for cases that can't happen"。

### D. 变异引导生成：Meta ACH 与 Catching JiTTests

- **ACH。** 工程师描述关注的故障，LLM 生成未被发现的变异体，再生成能杀死它的测试。7 个平台 10,795 个类，产出 9,095 个变异体和 571 个测试；test-a-thon 接受率 73%，其中判定与隐私相关 36%（[论文](https://arxiv.org/abs/2501.12862)）。
- **JiTTests。** 夜间只对高风险 diff 运行，生成设计上会失败的测试；经规则和 LLM 评估后找人确认（[Meta 2026-10](https://engineering.fb.com/2026/10/29/security/catching-bugs-before-they-land-jittestings-human-on-the-loop-approach-at-full-scale/)）。
- **结果。** 初始研究 41 个候选中确认 8 个，其中 4 个会造成严重故障（[2601.22832](https://arxiv.org/abs/2601.22832)）。后续自报 60% 真阳性、2026 上半年拦截 74 个 SEV 隐私缺陷。这些数字为 Meta 自报。
- **适合。** 有存量代码、已知故障类别、CI 算力和工程师可响应；回归硬化，或变更后拦截。
- **取舍 1。** ACH 以当前版本作回归 oracle，论文明确承认"cannot detect existing faults"（[全文](https://arxiv.org/html/2501.12862v1)）。
- **取舍 2。** JiTTests 依赖风险模型、算力和人工判定，且测试不进仓库。推断：个人库缺这些规模条件，只能借鉴"先命名故障，再证明测试抓得到"。

### E. 隔离 oracle 来源：独立上下文与测试访问控制

这一类主要来自研究，不是已成型的产品实践。

- **上下文隔离。** 只看任务描述、在新会话生成测试，检出率约 25%；同会话写完故障代码后再写，约 14%。Chain-of-Thought 等提示技巧未能弥补（[2607.05139 全文](https://arxiv.org/pdf/2607.05139)）。
- **访问控制。** 隐藏测试把作弊成功率压到接近零，但损害正常性能；只读测试恢复正常性能并阻止改测试。增加 `flag_for_human_intervention` 退出口，把 GPT-5 作弊率从 54% 降到 9%，o3 从 49% 降到 12%；对 Claude Opus 4.1 效果弱得多（[ImpossibleBench](https://arxiv.org/html/2510.20270v1)）。
- **验收驱动。** 受控研究中，模型能力足够时，TDD 提升 Web 应用准确率 15.5–23.7 个百分点；最优形态取决于模型能力和反馈可靠性（[TDDev](https://arxiv.org/abs/2605.17242)）。
- **适合。** 规格能先于代码写出；bug 修复、验收行为；可以开独立上下文。
- **取舍 1。** 成本上升，至少多一个上下文。隐藏测试还会降低正常完成率。
- **取舍 2。** 隔离只去掉实现偏差，不补规格缺失；绝对检出率仍低。

## 背景证据：无意义测试有多普遍

1. **Claim:** 33,596 个 agent PR 的 86,156 个测试补丁中，80.2% 只有弱 oracle 信号或没有显式 oracle 信号。**Sources:** [All Smoke, No Alarm](https://arxiv.org/abs/2606.18168)。**Support:** direct evidence（语法分类，不判断断言对错）。**Confidence:** medium。
2. **Claim:** LLM 测试生成主要捕获程序实际行为，因而难以发现 bug；但 oracle 的故障检测潜力高于 EvoSuite。**Sources:** [Konstantinou et al.](https://arxiv.org/abs/2410.21136)。**Support:** direct evidence。**Confidence:** medium（24 个 Java 仓库）。
3. **Claim:** 测试文件出现率不能代表测试质量。同仓库内 agent PR 改测试的几率是人工 PR 的 1.65 倍，但与测试质量的关系"remains uncertain"。**Sources:** [Testing with Coding Agents](https://arxiv.org/abs/2610.35297)。**Support:** direct evidence。**Confidence:** medium（观察性研究，Java）。

## Blind Spots

### 盲点 1：oracle 的来源缺少独立性，隔离上下文常被当成独立

各方案的 oracle 实际来自：

| 方案 | oracle 来源 | 原文证据 |
|---|---|---|
| Beck | agent 写，人选下一个测试并盯结果 | "for the next test add the keys in the reverse order" |
| superpowers | 同一 agent 自律 | "Derive expectations independently"，无独立写者机制 |
| Claude Code | 期望值来源由用户负责；reviewer 与编写上下文隔离 | "hasn't seen how the code was written"；只查 edge cases "have tests" |
| ACH | 当前代码 | "current version ... used as the regression oracle" |
| JiTTests | LLM 推断意图，最后找人确认 | 论文称不能依赖 LLM judge 给 ground truth（[2601.22832v1](https://arxiv.org/html/2601.22832v1)） |

可验证结论：

- **隔离有效但有上限。** 上下文隔离提升检出率，绝对值只到约 25%。作者指向 "independence, diversity, or external grounding"（[2607.05139](https://arxiv.org/pdf/2607.05139)）。
- **第二个 LLM 不等于 oracle。** LLM 生成 oracle 优于分类 oracle（[Konstantinou et al.](https://arxiv.org/abs/2410.21136)）。
- **推断。** 五类方案都没有回答一个问题：没有人值守、也没有现成规格时，期望值从哪来。这一问题正好是按需链要回答的。

### 盲点 2：跳过决策不可审计，也没有漏检回路

- **superpowers。** 跳过等于违规，例外靠问人，且自身对"trivial"的口径不一致（见方案 B）。
- **Beck。** 只有主观停止条件，并声明 "NOT how you should do TDD"。
- **Claude Code。** 只说"How strict you make the check is up to you"。旧版只有"easily verifiable"这一适用条件。
- **Meta。** 唯一明确做选择的方案。但它在 diff 提交后按风险选目标，决定的是"是否生成捕获测试"，不是编码前"是否红灯先行、放哪层"。已读材料未披露未选中 diff 的漏检率。
- **可验证结论。** 已读来源都没有给出"本次改动为何不写红灯、放哪层、事后是否漏检"的记录格式或反馈回路。
- **限制。** 这是对已读材料的缺失判断，不是全行业否定。

### 盲点 3："能变红"被当成"断言正确"

- **主张。** superpowers 称先写并看到失败的测试"has already proven it can fail"。这句话成立，但它证明的是敏感性。推断：错误期望同样会变红，再被实现满足，红绿循环全部通过。
- **失败不等于应该失败。** JiTTests 区分 weak catch（在当前版本上失败）与 strong catch（按真实预期也应失败）。初始研究中 41 个候选只确认 8 个，比例 19.5%（[2601.22832v1](https://arxiv.org/html/2601.22832v1)）。
- **变异杀死不等于符合规格。** ACH 的测试能杀变异体，但只保护当前行为（[全文](https://arxiv.org/html/2501.12862v1)）。
- **覆盖和触发也解释不了差距。** 2607.05139 的各配置行覆盖率大多在 95–99%，与检出率无一致关系；检出率最高的配置，触发率常常最低。作者推测差异来自断言质量，但承认未直接评估 oracle 正确性。
- **对本地规则的含义（推断）。** 空实现探针和消融探针只证明测试敏感，不证明期望正确，需要单独增加一步：核对期望值的来源。

## 对按需链的含义（推断）

1. **先判 oracle，再判红灯。** 记录期望值来源：规格、用户、外部系统、历史 bug 或参考实现。来源缺失时，先追问或停止，不写测试。
2. **在写实现之前，用新上下文写红灯。** 依据是 25% 对 14% 的差异。
3. **实现阶段把测试设为只读，并提供 flag 退出口。** 依据是 ImpossibleBench，注意其效果因模型而异。
4. **把跳过记录成可复查的决策。** 记录理由、层级和替代检查；出现漏检时回写判定规则。
5. **价值检查分两问。** "测试敏感吗"用探针回答；"期望对吗"用来源核对回答。

## Contradictions

- **LLM oracle 有多好。** Molinelli 等报告 LLM oracle 变异得分 43%，接近人类的 45%（[ASE 2025](https://homes.cs.washington.edu/~mernst/pubs/neurosymbolic-oracles-ase2025-abstract.html)）；Konstantinou 等认为它主要捕获实际行为、难以发现 bug。两者度量不同。推断：变异得分高与镜像实际行为可以并存。
- **是否看代码。** 2607.05139 称暴露实现会降低检出；其相关工作部分也引用 Huang 等的相反发现：故障代码与任务描述或正确代码合用可改善检出。未读 Huang 原文，只记录分歧。
- **JiTTests 真阳性率。** 19.5%（8/41）与 60% 口径不同：前者是初始研究中的候选确认率，后者是后续生产环境里参与工程师的报告。不可直接比较。
- **TDDev 数字。** 搜索摘要写 34–48 个百分点，当前 arXiv v2 摘要写 15.5–23.7。本文采用 v2，未核实差异原因。

## Missing evidence

- **Unknown：** 未找到"按需 TDD 与全量 TDD"对比 agent 产出的受控实验。
- **Unknown：** 换不同模型写测试能否超过同模型新会话。2607.05139 没有直接测这一点。
- **Unknown：** superpowers 的铁律和 Name the Break 门的实际效果。
- **Unknown：** 2607.05139 的结论能否外推到真实仓库和前沿模型。它是预印本，使用 Python 基准和偏轻量模型，并有意筛选难暴露故障，25% 的绝对值可能偏低。它的 "Test-Driven Workflow" 指独立生成测试，不是完整红绿循环。
- **验证限制：** `source_check` 对 14% 对 25% 返回 unclear，只给了 provider 摘要。我改为人工核对了论文全文中的摘要、Finding 3 和图 4 附近文字。图中各模型数值由 PDF 抽取，平均值以论文正文为准。
- **未读全文：** All Smoke、Testing with Coding Agents、TDDev、Molinelli 只读了摘要；JiTTests 论文全文由 answer 模式抽取，引文未逐字复核。Meta DRS 文章未读。

## Sources

- **Kept：**
  - [Canon TDD](https://tidyfirst.substack.com/p/canon-tdd) — Beck 的权威定义
  - [Augmented Coding](https://tidyfirst.substack.com/p/augmented-coding-beyond-the-vibes) — 一手 agent 实践和系统提示词
  - [Claude Code best practices](https://code.claude.com/docs/en/best-practices) 与[旧版存档](https://web.archive.org/web/2025/https://www.anthropic.com/engineering/claude-code-best-practices) — 官方现行立场和历史配方；存档具体日期 Unknown
  - [superpowers SKILL](https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md) 与 [writing-good-tests](https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/writing-good-tests.md) — 技能原文
  - [ACH 论文](https://arxiv.org/html/2501.12862v1)、[Meta ACH 博客](https://engineering.fb.com/2025/02/05/security/revolutionizing-software-testing-llm-powered-bug-catchers-meta-ach/)、[JiTTests 论文](https://arxiv.org/abs/2601.22832)、[Meta 2026-10 博客](https://engineering.fb.com/2026/10/29/security/catching-bugs-before-they-land-jittestings-human-on-the-loop-approach-at-full-scale/) — 生产级变异引导证据
  - [2607.05139](https://arxiv.org/abs/2607.05139)、[2410.21136](https://arxiv.org/abs/2410.21136)、[ASE 2025 Molinelli](https://homes.cs.washington.edu/~mernst/pubs/neurosymbolic-oracles-ase2025-abstract.html)、[2606.18168](https://arxiv.org/abs/2606.18168)、[2610.35297](https://arxiv.org/abs/2610.35297) — oracle 实证
  - [ImpossibleBench](https://arxiv.org/abs/2510.20270)、[TDDev](https://arxiv.org/abs/2605.17242) — 访问控制和 TDD 形态的实验证据
- **Rejected/deprioritized：**
  - [Vibe Coding 实验](https://link.springer.com/article/10.1007/s10664-026-10950-z) — 使用 GPT-3.5 Turbo，人类样本小，未直接回答 oracle 问题
  - MuTAP — 学术原型，已有生产证据 ACH，未深读
  - 第三方博客和论文摘要站 — 非一手来源

## Next steps

用本库 5–10 个真实改动做小实验：同会话写测试、新上下文只看规格写测试、人提供期望值三组，按注入故障的检出率和人工判定的无效测试数比较。这能直接回答"按需链的 oracle 门是否值回成本"。
