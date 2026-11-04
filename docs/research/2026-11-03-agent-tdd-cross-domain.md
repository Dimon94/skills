# Research: 按需 TDD 三个盲点的跨学科机制与查新

检索日期：2026-11-03。抓取内容按不可信数据处理，只作证据。

## Summary

7 个机制都有可执行步骤和查新判定。查新后，没有一个机制在软件行业完全空白。
6 个机制的核心已有软件来源，降级为"本行业已有"。只有抽样调度规则（B3）未查到软件先例，它也最不急。
值得带回按需链的不是新概念，而是 3 个未查到现成实现的组合点：实现前登记跳过决策，随机抽查跳过项，逐条记录期望值来源。这 3 点的结论都是推断。

## 判定总表

| ID | 盲点 | 机制 | 链上步骤 | 查新判定 |
|---|---|---|---|---|
| A1 | 1 oracle 独立性 | 参考标准独立性：掺入偏倚与盲法 | S2 oracle | 本行业已有；逐条来源字段未找到（推断） |
| A2 | 1 无规格无人值守 | 缺参考标准四分流 | S2 oracle | 方法本行业已有；作为门禁分流未找到（推断） |
| B1 | 2 跳过不可审计 | 前瞻注册与偏离对账 | S0 判定、S5 价值检查 | 组件本行业已有；实现前登记跳过未找到（推断） |
| B2 | 2 无漏检回路 | 部分验证偏倚：随机核验阴性 | S6 事后审计（新增） | 抽样核验本行业已有；用于跳过决策未找到（推断） |
| B3 | 2 审计成本 | skip-lot 抽样调度 | S6 事后审计 | 未找到（推断） |
| C1 | 3 能变红≠断言对 | 阳性、阴性对照与参考物质 | S5 价值检查 | 本行业已有 |
| C2 | 3 探针高估 | 谱系偏倚：探针不能只用极端样本 | S5 价值检查 | 本行业已有 |

链步骤记号：S0 判定是否红灯先行，S1 选层，S2 定 oracle，S3 红，S4 绿，S5 价值检查，S6 事后审计（本文提议新增）。

## 盲点 1：oracle 来源缺少独立性

### A1 参考标准独立性

**学科机制（诊断准确性研究）。** QUADAS 第 7 项问：参考标准是否独立于被评测试，即被评测试不构成参考标准的一部分。把被评结果用于最终判定时会产生 incorporation bias，抬高一致性并高估准确性。原文还强调：仅仅知道被评结果，不等于把它掺入了标准（[QUADAS](https://pmc.ncbi.nlm.nih.gov/articles/PMC305345/)）。Lijmer 的实证显示，判读参考标准时知道测试结果，诊断比值比约高估 1.3 倍，CI 1.0–1.9（[Lijmer 1999](https://pubmed.ncbi.nlm.nih.gov/10493205/)，摘要经 Europe PMC 核对）。

**为什么不是平行类比。** 两边结构相同：被评对象输出与参考标准比较，用一致性下结论。这里实现输出对应被评测试，期望值对应参考标准。镜像断言就是掺入：期望值由实现输出产生。结构映射是推断，但不需要额外假设。

**链上步骤：S2 oracle，写红灯之前。**

**可执行步骤：**
1. 为每条关键断言记录 `oracle_source` 和可定位坐标：规格、用户、外部系统、历史 bug 或参考实现。
2. 判三档：`independent`（来源早于实现，且作者没看实现）；`unblinded`（看过实现，但期望值能追溯到独立来源）；`incorporated`（期望值来自实现输出，或来自由实现反写的文档）。
3. `incorporated` 不算回归以外的证据，只能标为特征测试。缺来源时停止，转 A2。
4. 脚本校验规格时间戳早于实现首次提交。模型只负责填写来源。

**软件为何缺（推断）。** 断言 API 只接收一个字面量，没有来源字段。来源只留在作者脑中。人写测试时，评审者可以追问；agent 工作流里这个追问常常消失。

**查新判定：本行业已有。**
- 概念：Konstantinou 等指出 LLM oracle 捕获实际行为（[2410.21136](https://arxiv.org/abs/2410.21136)）；Code-First Oracle Bias 是社区条目（[agentpatterns](https://github.com/agentpatterns-ai/website/blob/main/patterns/anti-patterns/code-first-test-oracle-bias.md)）。
- 规则：skepticism 指南规定 oracle 优先级，并要求不读实现也能说出期望值来源（[test-authoring-guide](https://tangled.org/diego.codes/skepticism/blob/add-eval-harness/reference/test-authoring-guide.md)）。这是文字规则，已读部分未见记录格式。
- 强制：FoFo 的 Judge 只看规格，`separation-gate` 比较测试和代码的作者上下文 ID（[FoFo 源码](https://github.com/Sweet-Papa-Technologies/Agentic-SDLC)）。样例清单只有 `tests_by` 和 `code_by`，核对的是"谁写的"，不是"期望值从哪来"。
- 组织层：NASA 要求 IV&V 团队不参与开发，并自行建立对问题的理解；还要求其自行决定分析和测试范围（[NASA-STD-8739.8B](https://standards.nasa.gov/sites/default/files/standards/NASA/B/0/NASA-STD-87398RevB.pdf)，由 answer 模式摘录）。这本身就是软件实践，不是跨学科机制。财务独立在 agent 场景没有精确对应，不迁移。

**剩余差异：逐条断言的来源记录与三档判定未找到（推断）。** 搜索摘要曾给出一个 per-assertion YAML 示例，但它引用的原文没有此格式，判为摘要生成内容，不作证据。
检索词：`coding agent test expected value source provenance record assertion derived from spec oracle source field`；`"incorporation bias" OR "test oracle independence" LLM generated tests implementation-derived oracle`。
范围：通用搜索每词前 5–6 条，读 FoFo 部分源码；未查 GitHub 代码搜索、ACM DL、IEEE 全文库。

### A2 缺参考标准四分流

**学科机制。** Reitsma 等把缺失或不完美参考标准的解法分四组：(1) 插补或调整缺失结果；(2) 校正不完美标准带来的估计；(3) 用预定义规则、共识或统计模型组合多个结果，构造标准；(4) 放弃准确性范式，改做验证研究，把结果与临床数据、未来事件、治疗反应关联。结论是：没有可接受标准时，验证研究可作替代范式（[Reitsma 2009](https://pubmed.ncbi.nlm.nih.gov/19447581/)，摘要经 Europe PMC 核对）。

**链上步骤：S2 oracle。** 直接回答前一轮的问题：没有人值守、没有规格时，期望值从哪来。

**可执行步骤：**
1. 有独立来源：走准确性路径，进入 S3 红灯。
2. 来源只覆盖部分行为：实现前写定组合规则，用性质、蜕变关系或差分检查构造标准。规则必须先于结果写定，对应第 3 组的 predefined rule。
3. 组合来源可能同错：不把同模型的第二次意见算作独立来源。Knight 与 Leveson 发现独立编写的版本共同失效的频率高于独立性假设的预期（[1986](https://people.cs.rutgers.edu/~uli/cs673/papers/EvaluationMultiVersionProgramming86.pdf)，据检索摘要，PDF 未通读）。
4. 无任何来源：不写"正确性"红灯。走第 4 组：写特征测试并标明"不证明正确"，或者挂未来结果信号（线上错误、用户反馈）。同时标记 `flag_for_human`。
5. 记录走了哪一路，供 B1 对账。

**软件为何缺（推断）。** 软件有方法清单，缺"何时承认不知道"的停止规则。测试绿灯的输出是二值的，没有"未验证准确性"这个状态。

**查新判定：方法本行业已有。**
- Barr 等综述覆盖 specified、derived、implicit、human oracle，以及蜕变测试和 pseudo-oracle（[Oracle Problem 综述](https://discovery.ucl.ac.uk/id/eprint/1471263/)，据检索摘要）。
- ACH 明说以当前版本作回归 oracle，这等于第 4 组之外的显式降级（已由前轮来源覆盖）。
- agentpatterns 把特征测试列为合法例外。

**剩余差异：把四分流做成 S2 门禁并记录路径，未找到（推断）。**
检索词：`software test oracle reference standard imperfect "latent class" OR "no gold standard" ... metamorphic differential pseudo-oracle`。
范围同 A1。检索摘要未指出把潜类别模型用于软件 oracle 的具体论文，这一点证据弱。

## 盲点 2：跳过决策不可审计，也没有漏检回路

### B1 前瞻注册与偏离对账

**学科机制（临床试验）。**
- HARKing：把事后形成的假设当作事前假设呈现（[Kerr 1998](https://pubmed.ncbi.nlm.nih.gov/15647155/)）。
- 注册：ICMJE 要求在首例受试者同意入组时或之前，在公开注册库登记；以首次提交日期为准；回溯注册"不满足任何目的"（[ICMJE](https://www.icmje.org/recommendations/browse/publishing-and-editorial-issues/clinical-trial-registration.html)）。
- 分母：Turner 等对 74 项 FDA 登记研究发现 31% 未发表；FDA 判阳性的研究 37 项发表、1 项未发表（[Turner 2008](https://pubmed.ncbi.nlm.nih.gov/18199864/)）。这组数字说明：没有注册，就看不到分母。
- 对账：COMPare 把报告与预设结局逐一比较，并实时投递更正信。差异包括新增未预设结局、主要结局降为次要、时点改变（[COMPare 2019](https://link.springer.com/article/10.1186/s13063-019-3173-2)）。它还说明一点：只注册不对账，失实报告仍会持续。

**为什么不是平行类比。** 跳过决策的问题正是分母缺失：记录里只留下写了测试的改动。这和未发表试验消失是同一选择机制。把跳过记成"阴性试验"，分母才可计算（推断）。

**链上步骤：S0 判定写登记；S5 价值检查做对账。**

**可执行步骤：**
1. 第一次改实现前，向追加写账本写一行：改动 ID、决策（红灯、替代检查、不检查）、层级、oracle 来源、预期失败原因、替代检查、理由。
2. 时间由系统或 git 产生，不由 agent 自填。
3. 脚本比较登记时间与实现首次提交时间。回溯登记标为 `retrospective`，不算前瞻证据，并进入 B2 高优先层。
4. S5 对账四类偏离：登记的检查消失、新增未登记检查、层级或期望值改变、时点改变。每项要写原因；无原因时 fail-close。
5. 所有改动都入账，包括不写测试的改动。

**软件为何缺（推断）。** 提交说明写在改动完成之后，字段自由格式，也没人和计划比对。人类流程靠评审者兜底，所以这个缺口过去代价不高。

**查新判定：组件本行业已有。**
- 单改动测试记录：ChromiumOS 用 `TEST=` 行，并允许 `TEST=None`，指南说明它"generally free-form"（[ChromiumOS 指南](https://chromium.googlesource.com/chromiumos/docs/%2B/95cfb0a0196d36f272941876449596f6e4caddb2/contributing.md)，历史版本）。AOSP 有 `commit_msg_test_field` 钩子，要求 `Test:` 行（[repohooks](https://gerrit.googlesource.com/git-repohooks/%2B/b47d1dbfd25869a192417994617b7f755dedc4da/README.md)，历史版本）。
- 测试预先锁定：FoFo 的 `test-lock` 在 Phase 2 退出时写入 sha256，之后修改或删除测试即硬失败（[FoFo](https://github.com/Sweet-Papa-Technologies/Agentic-SDLC)，1.0.0-beta.4，未见效果数据）。
- 事后弱化检测：backcheck 从会话记录发现新增的 skip 标记（[backcheck](https://github.com/VectorInstitute/backcheck)）。

**剩余差异：在实现前登记"不写红灯"的决定，并与最终结果对账，未找到（推断）。** FoFo 的 `trace-gate` 要求每个需求有测试；已读部分未见按改动记录"不写红灯"的入口。我只读了 `phases.md` 前 120 行和 `gate-contract.md` 前 70 行。
检索词：`"pre-registration" OR "preregistered" tests before implementation ... hash locked`；`AI agent TDD skip test decision log waiver no test justification audit random sample missed bugs`；`test amendment test modified after implementation agent audit diff assertion weakening`。
范围：通用搜索，每词前 5 条。

### B2 部分验证偏倚：随机核验阴性

**学科机制。**
- Begg 和 Greenes 指出：只用获得确定性核验的病例估计准确性，遗漏未核验者会严重偏倚；校正需要对核验选择机制作假设（[Begg & Greenes 1983](https://pubmed.ncbi.nlm.nih.gov/6871349/)）。
- QUADAS 第 5 项问：是否全部样本或随机选取的样本接受了参考标准核验。第 6 项问：是否无论被评结果如何都用同一参考标准（[QUADAS](https://pmc.ncbi.nlm.nih.gov/articles/PMC305345/)）。
- 量级：阴阳性用不同参考标准时，诊断比值比约高估 2.2 倍（[Lijmer 1999](https://pubmed.ncbi.nlm.nih.gov/10493205/)）。
- 风险：假阴性很少时，标准校正方法不够用；模拟中假阴性从 0 变到 4，校正后 AUC 从 0.550 变到 0.852（[验证偏倚模拟研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC2600821/)）。

**为什么不是平行类比。** S0 的"不需要红灯"就是阴性判定。被判阴性的改动不再接受核验，于是判定规则的漏检率不可观测。这与原机制结构相同（映射为推断）。

**链上步骤：S6 事后审计。** 回写 S0 判定规则。

**可执行步骤：**
1. 总体：B1 账本中全部"替代检查"和"不检查"记录，按风险分层。
2. 脚本用固定种子随机抽样，保留抽样概率。作者无权选样或否决结果，这一点取自 NASA 的管理独立。
3. 同一参考标准：新上下文只看登记和规格，不看 diff，写检查并运行。失败不直接算漏检，要核对期望值来源。
4. 输出原始比率和区间：`确认缺陷数 / 抽查数`。零事件时，95% 上界约为 `3/n`（由 `1-0.05^(1/n)` 近似得出；[Hanley 1983](https://pubmed.ncbi.nlm.nih.gov/6827763/) 只核对到题录，正文未读）。例如 30 次抽查零漏检，只能说漏检率约低于 10%。
5. 被动上报的逃逸单列，不与抽查合并，也不与红灯改动直接比较。这是第 6 项的要求。
6. 每次确认漏检都回写 S0 规则，并给规则加版本号。

**不要做的事。** 样本小、假阴性少时，不套 Begg–Greenes 校正，只报原始比率。

**已知限制。** 参考标准本身不完美。前轮数据显示隔离上下文的检出率仅约 25%，所以抽查结果只是漏检率的下界（推断）。个人库的抽查量可能长期不足以给出窄区间。

**软件为何缺（推断）。** 工业界的抽样对象是已有测试的结果，补跑成本低。跳过红灯时，被跳过的测试根本不存在，核验要先把它写出来，单次成本高得多。

**查新判定：抽样核验本行业已有。**
- Meta 预测测试选择用"在一部分改动上运行全部潜在受影响测试"的数据训练模型，并定义 test recall 和 change recall（[Machalica 2018](https://arxiv.org/abs/1810.05286)）。这是软件中最接近的做法，但它评估的是已存在测试的选择。
- EPEX 随机抽 100 个判阴性例子核查假阴性（[USENIX Security 2016](https://www.usenix.org/system/files/conference/usenixsecurity16/sec16_paper_jana.pdf)，只见检索片段）。
- NASA 手册要求软件保证用随机抽查核实覆盖率证据（[SWE-190](https://swehb.nasa.gov/spaces/SWEHBVD/pages/102695525/SWE-190%2B-%2BVerify%2BCode%2BCoverage)）。核查对象是覆盖率度量，不是跳过决策。

**剩余差异：对"编码前不写红灯"的决定做随机独立核验，未找到（推断）。** 软件术语里也未见把 `verification bias` 用于此类决策。一条摘要称缺陷预测文献多用 label noise 和 sampling bias，这一点证据弱。
检索词：`test verification bias software testing skipped tests negative sampling estimate escape rate audit random sample of untested changes`；`"verification bias" OR "partial verification" software defect prediction unlabeled negatives`；`software change request 'no test' waiver auditing test exemption random sample escaped defects`；`Begg Greenes unverified negatives software ... static analysis`。
范围：通用搜索，每词前 5–6 条。

### B3 skip-lot 抽样调度

**学科机制（统计质量控制）。** 步骤（[NIST 6.2.7](https://www.itl.nist.gov/div898/handbook/pmc/section2/pmc27.htm)）：
1. 设计参考抽样方案。
2. 从逐批检验开始。
3. 连续 `i` 批（clearance number）接受后，转为随机检验比例 `f` 的批次。
4. 一批被拒，立即回到正常检验。

NIST 明确说，只有已证明质量很好时才能使用。MIL-STD-105D 体系同样由正常、加严、放宽方案和切换规则组成（[NIST 6.2.2.1](https://www.itl.nist.gov/div898/handbook/pmc/section2/pmc221.htm)）。

**链上步骤：S6 事后审计。** 决定 B2 的抽样比例。

**可执行步骤：**
1. 每个风险层、每个跳过理由单独计数。
2. 起始 `f=1`，每次跳过都审计。
3. 连续 `i` 次无确认漏检后，切到随机比例 `f`。起步值 `i=10, f=0.2` 是我的推断，没有证据支持。
4. 确认一次漏检，回到 `f=1`。
5. 高风险层始终 `f=1`。
6. 换模型或改技能时重置为 `f=1`。依据是 CLIA：更换试剂或关键部件后，恢复检测前要重跑对照（[42 CFR 493.1256(d)(6)](https://www.law.cornell.edu/cfr/text/42/493.1256)）。

**软件为何缺（推断）。** 该规则假设批次同质、质量过程稳定。代码改动高度异质。工业界转向用风险模型逐改动选择（如 JiTTests 和预测测试选择），不需要按批切换。

**查新判定：未找到（推断）。**
检索词：`skip-lot sampling acceptance sampling software testing continuous sampling plan regression test selection switching rules`；`software testing "clearance number" OR "reduced inspection" OR "tightened inspection" switch rule code review or test sampling`。
范围：通用搜索，每词前 5 条。一条摘要明确称未找到相关软件测试标准。"未找到"不等于不存在，未查统计软件工程专著和早期 Cleanroom 文献。Cleanroom 有独立认证团队和统计使用测试（[SEI](https://www.sei.cmu.edu/library/cleanroom-software-engineering-reference/)，只见简介），抽样对象是使用场景，不是跳过决策，所以不算命中。

**建议：先不做。** 先用 B2 的固定比例，账本积累到足够跳过记录后再考虑（推断）。

## 盲点 3："能变红"被当成"断言正确"

### C1 阳性、阴性对照与参考物质

**学科机制（检验医学、分析方法验证）。**
- 法规：定性检测每日必须包含阴性和阳性对照物（d)(3)(ii)；对照物必须与患者标本同样处理 (d)(8)；对照达标后才能报告结果 (f)；全部记录 (g)；没有对照物时，要有文档化的替代机制 (h)（[42 CFR 493.1256](https://www.law.cornell.edu/cfr/text/42/493.1256)）。
- 验证：ICH Q2(R2) 把 accuracy 定义为测量值与公认参考值的接近程度，通过参考物质比较、加标回收或正交方法证明；specificity 单独定义（[ICH Q2(R2)](https://database.ich.org/sites/default/files/ICH_Q2%28R2%29_Guideline_2023_1130.pdf)，3.3.1 和术语表，由 answer 模式摘录）。

**精确命中点。** 空实现探针和消融探针是阳性对照：已知有问题，测试应当变红。它们回答灵敏度。本地规则缺两样东西：阴性对照（已知正确，测试应当变绿）和 accuracy 证据（期望值接近公认参考值）。错误期望会通过全部阳性对照，只有后两者能拦住它（推断）。

**术语注意。** 软件没有标准叫法。本文以"变红"为阳性信号；一条检索摘要的定义方向正好相反。

**链上步骤：S5 价值检查。** 对照集在 S2 写定。

**可执行步骤：**
1. 阳性对照：沿用空实现和消融探针。
2. 阴性对照，按可得性选一种：
   - 纯重构或回归：旧版本。
   - 有参考实现：第三方库，或故意写得简单的慢实现。
   - 都没有：按规格手算的样例表，作为参考物质。用查表桩跑测试只能证明接线正确，不证明期望值正确，需要在记录里注明。
3. 把 S4 的新实现当作阴性对照是循环论证，不接受。
4. Accuracy：逐条核对期望值和 A1 的来源坐标。
5. 没有阴性对照时，按 (h) 记录替代检查，并标 `accuracy=unverified`。
6. 对照用同一测试命令运行。控制结果不达标，不得宣称完成。

**软件为何缺（推断）。** TDD 在红灯阶段没有正确实现，因此仪式天然只有一侧样本。变异工具也只生成有缺陷的一侧。

**查新判定：本行业已有。**
- Jahangirova 等评估 oracle 的假阳性（拒绝正确状态）和假阴性（接受错误状态），用测试生成揭示前者，用变异测试揭示后者；oracle 改进后，故障检测率平均提升 48.6%（[ISSTA 2016](https://cris.fbk.eu/handle/11582/305721)，只读摘要）。这几乎就是阴阳对照的软件版本。
- TestSuiteBench 同时报告生成测试在参考实现上的通过率（88%）和变异分（低于 60%）（[2610.13065](https://arxiv.org/abs/2610.13065)）。
- 也有研究质疑 LLM 测试工具的设计：oracle 被设计成通过，会确认 bug 并拒绝能暴露 bug 的测试（[2412.14137](https://arxiv.org/abs/2412.14137)）。

**剩余差异：**日常 agent 技能里把"已知正确样本"列为必需步骤，未在已读材料中见到。FoFo 把变异测试作为自带工具的可选门，并未要求已知正确样本。这是落地差距，不是新机制。
检索词：`positive control negative control software test validation mutation testing reference implementation`；`"negative control" "positive control" software unit test suite validate tests assay analogy`；`spec-based LLM test false positive reference implementation validity filter`。

### C2 谱系偏倚：探针不能只用极端样本

**学科机制。** Lijmer 等发现，在确诊患者和单独对照组上评测试，比在临床人群中评测试高估诊断表现，RDOR 3.0，CI 2.0–4.5（[Lijmer 1999](https://pubmed.ncbi.nlm.nih.gov/10493205/)）。QUADAS 把 patient spectrum 列为质量项（[QUADAS](https://pmc.ncbi.nlm.nih.gov/articles/PMC305345/)）。医学数字不能迁移到软件；能迁移的只是结构。

**精确命中点。** 空实现是"重症样本"，几乎任何带断言的测试都能抓到。这个结果高估了对真实缺陷的判别力（推断）。

**链上步骤：S5 价值检查。** 紧接空实现探针。

**可执行步骤：**
1. 空实现探针只作排除：没变红就淘汰测试；变红不算价值证据。
2. 从 S2 的规格条目出发，人工命名 1–3 个近似错误实现，例如边界差一、分支条件错、漏一个规格条件。
3. 由未写该测试的上下文生成这些变体，避免照着断言设计。
4. 风险高的改动才接入变异工具，并按改动范围过滤变异体。
5. 只报告这一组变体的结果，不宣称总体灵敏度。

**软件为何缺。** 实际并不缺，主要是 agent 技能流程没有接入。

**查新判定：本行业已有。**
- 极端变异：整方法替换，用来发现 pseudo-tested methods（[Niedermayr 2016](https://arxiv.org/abs/1611.07163)）；Descartes 是 PIT 的实现（[Descartes](https://github.com/STAMP-project/pitest-descartes/blob/master/README.md)）。
- 按需求隔离的变异体：TestSuiteBench 的变异体由单条需求生成，73% 恰被一个参考测试杀死（[2610.13065](https://arxiv.org/abs/2610.13065)）。
- 易杀变异体抬高分数：Betka 等，以及 commit-relevant mutants（[Betka 2022](https://onlinelibrary.wiley.com/doi/full/10.1002/smr.2450)、[Commit-relevant](https://link.springer.com/article/10.1007/s10664-022-10138-1)，均只见检索摘要，Betka 原文 403）。
- 检索词：`"spectrum bias" software testing mutants easy to kill trivial mutants overestimate test effectiveness`。"谱系偏倚"这个名称在软件里未见使用，但问题和对策都已存在。

## 候选核查结果

| 候选 | 结果 |
|---|---|
| 预注册与 HARKing | 采用，见 B1。测试锁定部分已被 FoFo 覆盖 |
| 阳性、阴性对照 | 采用，见 C1。软件版本已有 |
| NASA IV&V | 不算跨学科，它本身是软件实践。技术和管理独立用于 A1、B2；财务独立无精确对应，不迁移 |
| 诊断准确性 | 收益最大，产出 A1、A2、B2、C2。其 sensitivity 和 specificity 计算本身不新，软件已有 recall 与 oracle FP/FN |

## 建议优先级（推断）

1. **B1 + A1：** 实现前账本加 oracle 来源字段。成本低，并为其他机制提供分母。
2. **C1：** S5 增加阴性对照或显式 `accuracy=unverified`。直接补盲点 3。
3. **B2：** 固定比例抽查跳过项，回写 S0。
4. **A2、C2：** 写入规则，不新增基础设施。
5. **B3：** 暂不做。

## Contradictions

- **对照方向。** 软件没有统一的阳性、阴性对照定义，一条摘要与本文方向相反。使用时需先在本地定义。
- **校正还是不校正。** Begg–Greenes 被广泛使用，但模拟研究指出，假阴性少时标准校正方法不够。本文选择不校正，只报原始比率。
- **QUADAS 版本差异。** 一条检索摘要称 QUADAS-2 不再单列独立性问题，改由评价者定制。QUADAS-2 原文返回 403，未核实。本文引用的是 QUADAS 2003，第 7 项原文已核对。

## Missing evidence

- **Unknown：** 这些机制迁移到 agent 工作流后的效果。没有找到对照实验。
- **Unknown：** FoFo、backcheck 的实际效果。已读材料未给效果数据，FoFo 还是 beta。
- **Unknown：** 跳过决策的真实基础漏检率，因此无法计算 B2 需要的抽样量。
- **Unknown：** 把诊断偏倚的量级迁移到软件是否成立。Lijmer 的 RDOR 只来自医学研究，本文只迁移结构。
- **核验限制：**
  - PubMed 页面无法直接抓取，摘要改由 Europe PMC API 核对。
  - NASA 标准和 ICH Q2 由 answer 模式摘录，引文未逐字复核。
  - 未调用 `source_check`。关键声明改用原文或摘要人工核对；未能核对的已逐处标明。
  - ChromiumOS 和 AOSP 链接是历史提交版本，当前规定未核实。
  - MIL-STD-105D 的具体切换阈值只见搜索摘要，NIST 抓取页未显示，本文不引用具体数字。
  - COMPare 列举的第一类差异在片段中被截断，未写入。
  - 查新只覆盖通用搜索前几条结果和所列仓库，"未找到"结论都是推断。

## Sources

- **Kept：**
  - [QUADAS 2003](https://pmc.ncbi.nlm.nih.gov/articles/PMC305345/) — 第 5、6、7 项原文，诊断偏倚核心
  - [Reitsma 2009](https://pubmed.ncbi.nlm.nih.gov/19447581/) — 缺参考标准四分流
  - [Begg & Greenes 1983](https://pubmed.ncbi.nlm.nih.gov/6871349/)、[验证偏倚模拟研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC2600821/) — 部分验证偏倚及其校正限制
  - [Lijmer 1999](https://pubmed.ncbi.nlm.nih.gov/10493205/) — 设计偏倚实证量级
  - [ICMJE](https://www.icmje.org/recommendations/browse/publishing-and-editorial-issues/clinical-trial-registration.html)、[Kerr 1998](https://pubmed.ncbi.nlm.nih.gov/15647155/)、[Turner 2008](https://pubmed.ncbi.nlm.nih.gov/18199864/)、[COMPare 2019](https://link.springer.com/article/10.1186/s13063-019-3173-2) — 注册、HARKing、分母、对账
  - [NIST 6.2.7](https://www.itl.nist.gov/div898/handbook/pmc/section2/pmc27.htm)、[NIST 6.2.2.1](https://www.itl.nist.gov/div898/handbook/pmc/section2/pmc221.htm) — 抽样调度
  - [42 CFR 493.1256](https://www.law.cornell.edu/cfr/text/42/493.1256)、[ICH Q2(R2)](https://database.ich.org/sites/default/files/ICH_Q2%28R2%29_Guideline_2023_1130.pdf) — 对照与 accuracy
  - [NASA-STD-8739.8B](https://standards.nasa.gov/sites/default/files/standards/NASA/B/0/NASA-STD-87398RevB.pdf) — IV&V 独立性定义
  - [Jahangirova ISSTA 2016](https://cris.fbk.eu/handle/11582/305721)、[Machalica 2018](https://arxiv.org/abs/1810.05286)、[Niedermayr 2016](https://arxiv.org/abs/1611.07163)、[TestSuiteBench](https://arxiv.org/abs/2610.13065)、[2412.14137](https://arxiv.org/abs/2412.14137)、[Knight & Leveson 1986](https://people.cs.rutgers.edu/~uli/cs673/papers/EvaluationMultiVersionProgramming86.pdf) — 查新命中
  - [FoFo](https://github.com/Sweet-Papa-Technologies/Agentic-SDLC)、[backcheck](https://github.com/VectorInstitute/backcheck)、[Descartes](https://github.com/STAMP-project/pitest-descartes/blob/master/README.md)、[ChromiumOS 指南](https://chromium.googlesource.com/chromiumos/docs/%2B/95cfb0a0196d36f272941876449596f6e4caddb2/contributing.md)、[repohooks](https://gerrit.googlesource.com/git-repohooks/%2B/b47d1dbfd25869a192417994617b7f755dedc4da/README.md) — 实现侧查新
- **Rejected/deprioritized：**
  - [skepticism 指南](https://tangled.org/diego.codes/skepticism/blob/add-eval-harness/reference/test-authoring-guide.md)、[agentpatterns](https://github.com/agentpatterns-ai/website/blob/main/patterns/anti-patterns/code-first-test-oracle-bias.md) — 只作查新证据，非权威来源
  - VS Code TDD 指南 — 只有分阶段 agent 和文字规则，未增加机制
  - Skylos、paqad 等博客 — 非一手或营销内容，未采用
  - Beyond Test Presence（2607.12068）— 只做静态质量分析，与本问题的机制无关
  - 第三方 AQL 指南 — 已有 NIST

## Next steps

用已有实验设计验证 B1 + B2 的成本：回放本库 5–10 个真实改动，记录登记耗时，再让新上下文核验其中被判跳过的改动，看单次核验成本和发现数。结果决定 S6 能否长期运行。
