# 交付单位叫 MMF，Spec 是描述它的文档

Status: accepted

Related: 0004（措辞被本记录取代）、repo://GLOSSARY.md、repo://docs/research/2026-10-20-vertical-slicing-heuristics.md 第 6 组、repo://docs/research/2026-11-04-epic-to-spec-best-practices.md

## Context

0004 定下 Epic → 多个 Spec → 各 Spec 内 tickets，一个 Spec 对应一个 MR。这个结论成立，但 “Spec” 一词同时承担三样东西：验收与上线的单位、描述它的合同文档、`to-epic` 产出的候选。

同一套件里，repo://skills/vertical-slicing/SKILL.md 把 “垂直切片” 定义为一张票，执行交接写 “一票一 MR”。于是合入单位有两个答案：Spec 和 ticket。

repo://skills/ticket-split-100k/SKILL.md 用 100k token 估算决定要不要拆票，文中称其为 “执行预算”，但同一文件又说单张票不设上限。

用户已确认用 MMF（Minimal Marketable Feature，最小可上线功能）命名交付单位。MMF 来自 Denne 与 Cleland-Huang 的 Incremental Funding Methodology：按客户认可价值切出的最小交付块，多张故事票可以聚成一个 MMF。书中逐字定义为 Unknown。

## Decision

### 1. 单位轴只有 Epic、MMF、ticket

- Epic：一个 MMF 装不下的目标。owner 是 `to-epic`。
- MMF：验收、合入与上线的单位。一个 MMF 对应一份 Spec、一个 MR、N 张 ticket。一个上下文装得下时 N 为 0，不拆票。
- ticket：MR 分支内的执行单位。能独立检查，不要求能单独上线，默认不单独合入 main。

Spec 不是单位。它是描述一个 MMF 的合同文档，写行为、状态与验收，owner 是 `to-spec`。0004 中作为交付单位的 “Spec” 和 “Spec 候选” 读作 MMF；0004 的结论 “一份合同对应一个 MR” 不变。

### 2. 边界测试

- Epic 与 MMF：把需求切成两半，每半都能单独上线且单独有人愿意用，就是多个 MMF。
- MMF 上限：只用上一条切分测试。存在一种切法让每半都能单独上线且单独有人用，就回 `to-epic` 重切 MMF，不拆 MR；拆 MR 会让合入单位和验收单位再次分离。切不开就是一个 MMF，不论大小。规模不另设测试，只看第 7 节的重切信号。
- MMF 与 ticket：ticket 能独立检查，但不要求能单独上线。整体自己都上不了线的需求不足一个 MMF，它是某个 MMF 里的 ticket。

### 3. 选 MMF 作术语

- MMF 自带下限判据：“marketable” 要求单独有人愿意用。这正是 Epic 与 MMF 边界测试的问法。
- 不选 Increment。它在 Scrum 中指累加到既有产品上的可用产物，节奏跟 Sprint 绑定；本仓不采用 Sprint（第 6 节），它也不带 “单独有人愿意用” 的判据。
- 不选 Feature。它是日常泛称，任何大小都能叫 feature，没有上下限可测。
- 不选垂直切片。垂直切片是切法，Epic 切成 MMF、MMF 切成 ticket 都用它；拿它命名某一层，会再造一个多义词，正是现在 vertical-slicing 与 0004 冲突的根源。

代价：MMF 是外来缩写，读者第一次见要查 repo://GLOSSARY.md。

### 4. 默认一个 MMF 一个 MR，逐票合入是例外

默认路径：ticket 留在 MR 分支内，MMF 做完一次审查、一次合入、一次上线。合入单位与验收单位重合，main 上没有半成品，也不需要隐藏手法。代价是分支比逐票合入长；第 7 节的重切信号让用户每次都看见这个代价。

例外：用户看过一个 MMF 的票数与拆分信号合计后，确认它切不开、又要逐票合入时，才逐票合入 main，用 toggle 隐藏未完成部分，做完再放量。它换来逐票的小合入，代价是 toggle 和收尾工作，所以只作例外。

### 5. 共用的使能工作归第一个用到它的 MMF

多个 MMF 共用的使能工作（如一次数据库迁移）单独上线没人用，不是 MMF。它作为结构票放进第一个用到它的 MMF。

### 6. 不采用 Sprint

Sprint 管人类团队的时间盒。agent 侧的节奏已由并发上限和拆分信号覆盖，再加时间盒没有要管的对象。

### 7. token 估算只是拆分信号

拆票时每票的 token 估算叫拆分信号，对应 `ticket-sizing` 逐票表的 “拆分信号（tokens）” 列。它只回答 “这张票要不要再拆”：超过 `ticket-split-100k` 的拆分线（100k）就去找验收边界，不约束执行。描述它不用 “预算” “上限”：这两个词会被执行方读成开发限额。

一个 MMF 的票数与拆分信号合计是重切信号。`vertical-slicing` 在请用户发布票之前，把切片表、每票拆分信号、票数与合计摆给用户，附上推荐与理由；用户三选一：照此执行、运行 `to-epic` 重切 MMF、确认切不开并转第 4 节的例外。

### 8. MMF 上限不给时间数字，也不给合计阈值

用户的判断：时间数字给不明确，“一周” 也是拍脑袋；AI 开发很快，按人估成一周的 MMF，用 AI 可能半天就做完。token 好算，其他尺度不好算。所以 MMF 上限不用 “短分支” “一次审完” 这类时间或体感判据，规模只用 token 尺看。

合计也不设阈值。现在没有 MMF 合计与实际交付的实测数据；编一个合计阈值和编 “一周” 是同一个错误。agent 的义务是每次报告合计并给出推荐与理由，裁决归用户。

## Consequences

### 正面

- 一个词只表达一件事：MMF 是单位，Spec 是文档，垂直切片是切法。
- 每条边界都有可回答的测试，拆分争议有判据。
- 默认路径下合入、验收、上线是同一个单位。

### 负面 / 成本

- 现有 Skill、README 与模板仍用旧措辞，需按各自 owner 改写。改完之前，读者会同时看到 “Spec 候选” “一票一 MR” 与本记录的说法。
- 默认 MR 比逐票合入大，审查负担更重；没有阈值替用户挡住，靠每次报告的合计与推荐由用户控制。

### 边界

本记录冻结：单位轴、边界测试、默认一个 MMF 一个 MR 及逐票合入的例外条件、使能工作的归属、不采用 Sprint、token 估算的定位、MMF 上限不设时间数字与合计阈值。

本记录不裁决：
- 各 Skill 的具体改写，归各 Skill owner 的后续改动。
- 多大的合计该推荐重切：Unknown，缺实测数据；本记录不设阈值。
- delivery-pipeline 的 `ticket_release` 模式如何对应第 4 节的例外路径：Unknown。

改为默认逐票合入、引入时间盒节奏，或给 MMF 上限设时间数字或合计阈值，需要立新 ADR 取代本记录。
