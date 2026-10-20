# 垂直切片：把大 spec 拆成可独立上线的小票

职责：记录一手资料研究，支撑新 skill 的拆票启发式。执行合同归 [vertical-slicing](../../skills/vertical-slicing/SKILL.md)。访问日期统一为 2026-10-20。

结论：好切片是一条贯穿各层的薄路径。它围绕一个业务结果，能在数小时到数天内合入 trunk 并部署到生产。第一片是 walking skeleton：端到端最小可运行版本。后续切片沿 story map 的 backbone 逐层加厚。合入时还不该让用户看到的部分，用 release toggle、dark launch、branch by abstraction 或 parallel change 隐藏或分阶段迁移，而不是拉长寿分支。按层拆、按组件拆、"最后集成"票都违背这些来源的共同主张。

## 来源边界

- 只用作者原文、作者站、官方文档或出版社页。抓取不到正文的部分写 Unknown。
- 书籍只核验公开节选或官方 tip 页，未通读全书。
- "作者原意"是来源摘要；"拆票启发式、拆票反问、反例、可保留例外"是为本任务推导的内容，统一属推断。

## 十一组拆票关键词

### 1. Vertical slice、Tracer bullet、Walking skeleton

**作者原意**
- Cockburn 引自 Crystal Clear（2004）的定义："A Walking Skeleton is a tiny implementation of the system that performs a small end-to-end function. It need not use the final architecture, but it should link together the main architectural components. The architecture and the functionality can then evolve in parallel." 他举例：一个项目第一周先让各系统沿环传递一条 null message；此后每周都要求环保持完整。[Walking skeleton，Alistair Cockburn，2008 存档版](https://web.archive.org/web/20081016063214/http://alistair.cockburn.us:80/Walking+skeleton)（原址 [alistair.cockburn.us/walking-skeleton](https://alistair.cockburn.us/walking-skeleton) 当日返回人机验证页，改用 Wayback 存档）。
- 同页 Cockburn 认为 Hunt 与 Thomas 的 "tracer bullets" 是近似概念。他在评论中补充：新系统的 walking skeleton 可以是把 db 中唯一一格的 "Hello World" 穿过各层显示到屏幕，再把一次输入穿回 db。[同页 2017 存档版评论](https://web.archive.org/web/20171103153013/http://alistair.cockburn.us/Walking+skeleton?version=6299)。
- 《The Pragmatic Programmer》20 周年版 Tip #20："Use Tracer Bullets to Find the Target — Tracer bullets let you home in on your target by trying things and seeing how close they land." Tip #42："Take Small Steps—Always"。[Pragmatic Bookshelf Tips](https://pragprog.com/tips/)。书中关于 tracer code 的正文（如"不丢弃""精简但完整"）：Unknown，O'Reilly 预览返回 403。
- 垂直切片的定义见第 3 组 Humanizing Work 与第 4 组 Wake 的分层蛋糕。

**拆票启发式（推断）**
- 第一张票就是 walking skeleton：用户入口到持久层各走一遍，功能可以简陋，但要能部署和观察。
- 后续每张票在骨架上加一段行为，并保持骨架完好，对应 Cockburn 的"环必须保持完整"。
- tracer bullet 用于不确定方向：先打通一条真实路径，再根据落点修正。它不是丢弃式原型；丢弃式原型归 Tip #21 "Prototype to Learn"。

**拆票反问**：这张票合入后，能从真实入口触发并看到结果吗？它连接了哪些主要架构组件？

**反例**："搭建数据库 schema"、"实现全部 API"、"接前端"三张票分开排期，前两张合入后没人能体验任何东西。

**可保留例外**：纯丢弃式 spike 或原型，用来回答一个问题，结论写回票里，代码不进 main。

### 2. Elephant Carpaccio、nano-incremental development

**作者原意**
- Cockburn：carpaccio 是切得几乎透明的牛肉。敏捷开发者接受的是 "incremental end-user-visible functionality that takes anywhere from 15 minutes to a few hours or a day to implement"。他同时警告：user stories 不传达整体的大小与形状，需要 story map 或 use case 来保证切完仍是"一头大象"。[Elephant carpaccio，Alistair Cockburn，2008-10-05，存档版](https://web.archive.org/web/20081017032508/http://alistair.cockburn.us:80/Elephant+carpaccio)。
- 练习页：15 分钟内把需求切成 "8-18 user stories or feature requests, estimated to be programmable at 3-8 minutes each, each a potentially demo-able end-of-sprint result (no UI mockups, no data tables, no showing code, etc.)"。学习目标包括 "How to slice large applications into 1-day to 1-week requests, from the business perspective"。[Elephant Carpaccio exercise，Cockburn，2010，存档版](https://web.archive.org/web/20140329203352/http://alistair.cockburn.us/Elephant+Carpaccio+exercise)。
- Kniberg 的引导指南写 10-20 片，每片 "Implementable (including user interface) in 2-6 minutes"、"Noticeable different from last slice"、"More valuable to customer than last slice"；并要求先做完 5 个州的税率，再做折扣，因为税率是法定要求。[Elephant Carpaccio facilitation guide，Henrik Kniberg，2013-07-25](https://blog.crisp.se/2013/07/25/henrikkniberg/elephant-carpaccio-facilitation-guide)、[指南全文（Kniberg 博文链接的 Google Doc）](https://docs.google.com/document/d/1TCuuu-8Mm14oxsOnlk8DqfZAA1cvtYu9WGv67Yj_sSk/pub)。

**拆票启发式（推断）**
- 每片都要满足三条：用户可见、与上一片有可察觉差别、比上一片更有价值。
- 排序先做强制约束（法规、核心规则），再做可选增强。
- 切片前先有整体形状（story map 或 spec 的 use case 列表），防止只切尾巴后撞上"象身"。

**拆票反问**：这片演示时，用户能看到什么和上一片不同的东西？去掉它，下一片还能独立演示吗？

**反例**：一张票只交付"数据表设计"或"UI mockup"，Cockburn 在练习规则里明确排除。

**可保留例外**：练习里的分钟级切片是训练尺度。生产拆票的尺度见第 10 组 DORA（数小时到数天）。

### 3. Story splitting：SPIDR、splitting patterns、meta-pattern

**作者原意**
- Cohn 的 SPIDR 五种拆法：Spike（"A research activity a team undertakes to learn more about some backlog item"）、Paths（按备选路径拆，如刷卡与 Apple Pay）、Interfaces（按浏览器、硬件拆，或先做简化界面）、Data（先支持数据子集）、Rules（先放宽业务规则，后续补上）。[SPIDR: Five Simple but Powerful Ways to Split User Stories，Mike Cohn](https://www.mountaingoatsoftware.com/blog/five-simple-but-powerful-ways-to-split-user-stories)。
- Lawrence 与 Green 定义 story 为 "a description of a change in system behavior from the perspective of a user"；垂直切片是 "a work item that delivers a valuable change in system behavior such that you'll probably have to touch multiple architectural layers to implement the change"。按层拆 "may satisfy small, but it fails at independent and valuable"。[The Humanizing Work Guide to Splitting User Stories，Richard Lawrence & Peter Green](https://www.humanizingwork.com/the-humanizing-work-guide-to-splitting-user-stories/)。
- 同指南列 9 种模式：Workflow Steps、Operations（CRUD）、Business Rule Variations、Data Variations、Data Entry Methods、Major Effort、Simple/Complex、Defer Performance、Break Out a Spike。Workflow Steps 的建议："the biggest value often comes from the beginning and end ... build the simple end-to-end case first and then add the middle steps"。Simple/Complex 问 "What's the simplest version of this?"。Meta-pattern：找到核心复杂度，列出其变体，把变体缩减为一条完整路径。选择标准："Choose the split that lets you deprioritize or throw away a story"，或得到大小更均匀的故事。[同上](https://www.humanizingwork.com/the-humanizing-work-guide-to-splitting-user-stories/)。
- 同站指出 "Most teams slice by technical layer (build the database, then the API, then the UI) or by convenience ... Slicing for value is different."。[Vertical Slicing: From Initiative to User Stories，Humanizing Work](https://www.humanizingwork.com/vertical-slicing-from-initiative-to-user-stories/)。
- Story Splitting Flowchart PDF（版权 Agile For All 2011-2013）：[PDF](https://ss-usa.s3.amazonaws.com/c/308454236/media/161515da8600487f4b71408515470829/Story-Splitting-Flowchart.pdf) 已下载，本地无 PDF 文本工具，流程图逐步内容：Unknown。humanizingwork.com 上的 flowchart 独立页返回 404。

**拆票启发式（推断）**
- 先找核心复杂度，再按 Paths、Rules、Data、Workflow Steps 把变体剥离；第一片走最简单的完整路径。
- Spike 单独成票，产出是答案，不是生产代码；有其他拆法时不先拆 spike。
- 优先选能让低价值部分被延后或丢弃的拆法。

**拆票反问**：这个需求的核心复杂度是什么？最简单的完整路径是哪条？哪些变体可以延后？

**反例**：按 CRUD 拆时只做 Create 不做 Read，用户写入后看不到结果；按 Workflow 拆时先做中间步骤，首尾都没有。

**可保留例外**：Defer Performance 可以先上一个慢但正确的版本，前提是性能不是这片的验收合同。

### 4. INVEST、分层蛋糕

**作者原意**
- Wake 2003 年提出 INVEST：Independent、Negotiable、Valuable、Estimable、Small、Testable。Independent："we'd like them to not overlap in concept, and we'd like to be able to schedule and implement them in any order"。Valuable："it needs to be valuable to the customer"。Small："Stories typically represent at most a few person-weeks worth of work"。[INVEST in Good Stories, and SMART Tasks，Bill Wake，2003-08-17](https://xp123.com/invest-in-good-stories-and-smart-tasks/)。
- 同文："Think of a whole story as a multi-layer cake ... the best way is to slice vertically through the layers"，因为 "a full database layer (for example) has little value to the customer if there's no presentation layer"。[同上](https://xp123.com/invest-in-good-stories-and-smart-tasks/)。

**拆票启发式（推断）**
- 把 INVEST 当逐票检查表；Independent 与 Valuable 最常被横切票破坏。
- Wake 的 "few person-weeks" 是 2003 年的故事上限；合入 main 的粒度应按第 10 组 DORA 收紧到数天以内。

**拆票反问**：这张票能不依赖其他未完成票单独排期吗？客户能从它得到什么？Testable 的验收场景是什么？

**反例**：一张票只写"持久层"，必须等"展示层"票完成才有价值。

**可保留例外**：明确的前置结构票（见第 11 组），只要它不改变行为、能独立合入，并且服务于紧随其后的行为票。

### 5. User Story Mapping：backbone、walking skeleton、release slices

**作者原意**
- Patton：地图顶部大项是 "essential capabilities the system needs to have. I refer to them as the 'backbone' of the software"。顶部故事描述 "the smallest possible system you could build that would give you end to end functionality. This is what Alistair Cockburn refers to as the 'walking skeleton'"。他用胶带画出每个 release 的水平泳道，"We're slowly building up the system not a feature at a time, but rather by building up all major features a little at a time ... That way we never release a car without brakes."。[The New User Story Backlog is a Map，Jeff Patton，2008-10-08（2023 更新）](https://jpattonassociates.com/the-new-backlog/)。
- "release slice" 作为术语在 Patton 2014 年书中的确切表述：Unknown，未核验书籍正文；2008 原文用的是 "horizontal swim lanes for each release"。

**拆票启发式（推断）**
- 拆 epic 前先排 backbone：用户活动按时间从左到右。
- 第一条水平切线横跨整个 backbone，就是 walking skeleton；不要先把某一列做深。
- 每条切线都是一组可上线的票；切线以下的票可以延后或删掉。

**拆票反问**：这组票横跨了 backbone 的每个活动吗？有没有"没刹车的车"：某一步缺失导致整条流程不可用？

**反例**：先把"注册"做到完美（第三方登录、头像、邮件验证），而"下单""支付"还不存在。

**可保留例外**：backbone 本身仍在探索时，先用 spike 或原型确认活动顺序，再画切线。

### 6. MVP 与 MMF（只取切片相关定义）

**作者原意**
- Ries："the minimum viable product is that version of a new product which allows a team to collect the maximum amount of validated learning about customers with the least effort."。[Minimum Viable Product: a guide，Eric Ries，2009-08-03](http://www.startuplessonslearned.com/2009/08/minimum-viable-product-guide.html)。
- Denne 与 Cleland-Huang 提出 Incremental Funding Methodology：软件 "developed and delivered in carefully prioritized chunks of customer valued functionality. These chunks are known as Minimum Marketable Features or MMFs"。书目还包括 "The MMF Precedence Graph"、"Sequencing MMFs and AEs"、"Clustering User Stories into MMFs"。[Software by Numbers 作者站，Mark Denne](http://home.markdenne.com:8081/)、[出版社页，InformIT，2003](https://www.informit.com/store/software-by-numbers-low-risk-high-return-development-9780131407282)。MMF 在书中的逐字定义：Unknown，未读到正文。

**拆票启发式（推断）**
- MVP 回答"最少做什么能验证学习"；MMF 回答"最小什么能交付给客户并产生价值"。拆 epic 时先划出 MMF 边界，再在 MMF 内部按故事切片。
- 多张故事票可以聚成一个 MMF（书目 "Clustering User Stories into MMFs"）。所以单张票不必独立有市场价值，但必须独立可部署、可体验。
- MMF 之间有前置依赖图；排票时显式写出依赖，不靠隐式顺序。

**拆票反问**：这组票合起来对应哪个 MMF？这张票能帮团队验证哪条假设？

**反例**：把整个 v1 叫 MVP，内部不再切片，半年后一次上线。

**可保留例外**：受监管领域的 MMF 必须完整才能对外 release；这时仍可分片部署到生产，用 toggle 延后 release（见第 8 组）。

### 7. Trunk-based development、short-lived feature branches

**作者原意**
- Hammant 站点定义："A source-control branching model, where developers collaborate on code in a single branch called 'trunk' and resist any pressure to create other long-lived development branches"。CI 的核心要求是 "all team members commit to trunk at least once every 24 hours"。[Trunk Based Development，Paul Hammant 等](https://trunkbaseddevelopment.com/)。
- Short-lived feature branch："the branch should only last a couple of days. Any longer than two days, and there is a risk of the branch becoming a long-lived feature branch"；开发者数 "should stay at one (or two if pair-programming)"。[Short-Lived Feature Branches](https://trunkbaseddevelopment.com/short-lived-feature-branches/)。
- DORA："Each developer divides their own work into small batches and merges that work into trunk at least once (and potentially several times) a day"；高绩效做法包括 "three or fewer active branches"、"Merge branches to trunk at least once a day"、"Don't have code freezes and don't have integration phases"。[Trunk-based development，DORA](https://dora.dev/capabilities/trunk-based-development/)。

**拆票启发式（推断）**
- 一张票的分支寿命上限约两天；预计超过就继续拆，或改用第 8、9 组手法。
- 一张票一个开发者（或一对）；共享分支说明票太大。
- 不设"集成阶段"票；集成发生在每片合入时。

**拆票反问**：这张票能在两天内合回 main 吗？不能，是因为范围大，还是因为缺少隐藏未完成工作的手法？

**反例**：feature/xxx 分支开发三周，最后一周专门解冲突。

**可保留例外**：发布分支（branch for release）只做修复，不做开发；Hammant 站点把它列为单独模式。

### 8. Feature toggles、dark launch、separating release from deployment

**作者原意**
- Hodgson："Feature Toggles (often also refered to as Feature Flags) are a powerful technique, allowing teams to modify system behavior without changing code."。四类：Release、Experiment、Ops、Permissioning。Release Toggles "allow incomplete and un-tested codepaths to be shipped to production as latent code which may never be turned on"，是实现 Continuous Delivery 原则 "separating [feature] release from [code] deployment" 的最常见方式；它们 "should generally not stick around much longer than a week or two"。toggles "come with a carrying cost"，团队应把这份库存 "as low as possible"。[Feature Toggles (aka Feature Flags)，Pete Hodgson，martinfowler.com，2017-10-09](https://martinfowler.com/articles/feature-toggles.html)。
- Fowler："Dark launching a feature means taking a new or changed back-end behavior and calling it from existing users without the users being able to tell it's being called"，用于在公开前评估负载和性能。它最适合增强已有交互；依赖用户选择的功能应用 Canary Release。[Dark Launching，Martin Fowler，2020-04-29](https://martinfowler.com/bliki/DarkLaunching.html)。
- DORA："You can also dark launch changes by using a feature toggle"；"start development at the service or API layer, not at the UI layer"，这样能 "check in code for small batches that have been completed, but for features that are not yet fully complete"。[Working in small batches，DORA](https://dora.dev/capabilities/working-in-small-batches/)。

**拆票启发式（推断）**
- deploy 与 release 是两件事：每片都 deploy 到生产；release 可以晚于 deploy，由 toggle 控制。
- 用 toggle 的票要写明：toggle 名、默认值、谁能看到、何时打开、何时删除。删除 toggle 本身是一张票。
- DORA 的"先做 API 层"与"每片有人能体验"不冲突：dark 状态下，内部人员或 canary 群体就是体验者。

**拆票反问**：这片部署后默认对谁可见？没打开时，现有行为是否完全不变？toggle 何时删？

**反例**：toggle 留了一年，代码里两套路径都在维护；toggle 关闭时仍然执行了新代码的副作用（写库、发消息）。

**可保留例外**：Ops 与 Permissioning toggle 可以长期存在，但它们是产品能力，不是拆票手段。

### 9. Branch by Abstraction、Parallel Change（expand-contract）

**作者原意**
- Fowler："Branch by Abstraction is a technique for making a large-scale change to a software system in gradual way that allows you to release the system regularly while the change is still in-progress."。步骤：建抽象层并让调用方经由它；逐步迁移调用方；在抽象后实现新 supplier；逐步切换，最后删除旧 supplier。术语由 Paul Hammant 在倡导 trunk-based development 时提出。[BranchByAbstraction，Martin Fowler，2014-01-07](https://martinfowler.com/bliki/BranchByAbstraction.html)。
- Hammant 站点的适用场景："a change that is going to take five days to complete"，且 "a lot of developers already depending on the code"。[Branch by Abstraction，trunkbaseddevelopment.com](https://trunkbaseddevelopment.com/branch-by-abstraction/)。
- Sato："Parallel change, also known as expand and contract, is a pattern to implement backward-incompatible changes to an interface in a safe manner, by breaking the change into three distinct phases: expand, migrate, and contract."；"Most database refactorings follow the parallel change pattern"；它让代码 "be released in any of these three phases"。[ParallelChange，Danilo Sato，martinfowler.com，2014-05-13](https://martinfowler.com/bliki/ParallelChange.html)。

**拆票启发式（推断）**
- 替换内部组件（库、存储、算法）用 branch by abstraction；每一步一张票，每张都能合入并部署。
- 改接口或 schema 用 expand → migrate → contract 三类票；contract 票必须等迁移完成证据。
- 这两种手法本身不产生用户可见结果。它们是结构票，要紧挨着它服务的行为票排期（见第 11 组）。

**拆票反问**：这次改动是否破坏现有调用方或数据？能否先 expand 再 contract？旧实现何时删除，谁验证没有调用方？

**反例**：在长寿分支上直接改表结构和全部调用方，一次性合并。

**可保留例外**：调用方只有一处、改动一小时内能完成的接口变更，直接改更简单。

### 10. DORA：small batches、deployment frequency、change lead time

**作者原意**
- DORA 建议每批工作遵循 INVEST；"Any batch of code that takes longer than a week to complete and check is too big"；"you should be able to complete batches of work in small increments of time, meaning hours to a couple days"；"Ideally, your developers should be checking multiple small releasable changes into trunk at least once per day"。常见陷阱："Working in small batches but then regrouping the batches before sending them downstream for testing or release"。[Working in small batches，DORA](https://dora.dev/capabilities/working-in-small-batches/)。
- 同页把 MVP 作为产品级小批量的例子："a minimum viable product, or MVP, is a prototype of a product with just enough features to enable validated learning about the product and its business model"。[同上](https://dora.dev/capabilities/working-in-small-batches/)。
- 指标定义：Change lead time 是 "The amount of time it takes for a change to go from committed to version control to deployed in production"；Deployment frequency 是 "The number of deployments over a given period or the time between deployments"。[DORA's software delivery performance metrics](https://dora.dev/guides/dora-metrics/)。

**拆票启发式（推断）**
- 票的尺寸上限：开发加检查不超过一周，目标数小时到两天。
- 不要把小票重新攒成一次大发布；每片合入即进入部署流水线。
- 拆票效果可以用 lead time 与 deployment frequency 观察，但这不是单张票的验收标准。

**拆票反问**：这片从 commit 到生产要多久？有没有在等别的票一起发？

**反例**：十张小票都合入了，但约定"等全部完成后统一测试上线"。

**可保留例外**：外部审批（应用商店审核、监管报备）强制批量 release；deploy 仍可小批，release 由 toggle 聚合。

### 11. Make the change easy、Tidy First：结构变更与行为变更分开

**作者原意**
- Beck 原推："for each desired change, make the change easy (warning: this may be hard), then make the easy change"。[Kent Beck，X/Twitter，2012-09-25](https://twitter.com/KentBeck/status/250733358307500032)（经 X 官方 oEmbed 接口核验原文）。
- Beck 在 Mastering Programming 里写："Slicing. Take a big project, cut it into thin slices, and rearrange the slices to suit your context."，以及 "When faced with a hard change, first make it easy (warning, this may be hard), then make the easy change."。[Mastering Programming，Kent Beck 通讯](https://newsletter.kentbeck.com/p/mastering-programming)。
- Beck："Constrain PRs to only contain one kind of change or the other. Never both."；"Structure changes are (usually) reversible and behavior changes are not."；预期结果是 "PRs will be smaller. What used to be one big PR will now be a sequence."。[Structure & Behavior PRs，Kent Beck，2021-02-11](https://newsletter.kentbeck.com/p/structure-and-behavior-prs)。
- 《Tidy First?》第 16 章 "Separate Tidying" 存在于 [O'Reilly 目录](https://www.oreilly.com/library/view/tidy-first/9781098151232/ch16.html)，正文抓取返回 403：Unknown。

**拆票启发式（推断）**
- 行为切片太难时，先拆一张结构票（tidying），让下一张行为票变简单。
- 结构票与行为票不混在同一个 PR；结构票不改变可观察行为，靠已有测试证明。
- 结构票只服务紧随其后的行为票，不预留假想需求。

**拆票反问**：这张票同时改结构和行为吗？能否先合一个纯结构 PR？这个结构改动服务哪张行为票？

**反例**：一个 PR 同时重命名 40 个文件并修改计费规则，审阅者无法区分哪处改了行为。

**可保留例外**：结构改动只有几行且与行为改动不可分，在同一 PR 内分开提交即可。Beck 在 [Getting Untangled](https://newsletter.kentbeck.com/p/getting-untangled) 中把"拆成一串 commit 放在同一 PR"列为可选做法。

## 拆票反问（汇总）

1. 这张票合入 main 并部署后，谁能在哪个入口体验到什么结果？
2. 它和上一片相比，用户能察觉哪处差别？
3. 它穿过了哪些层？如果只碰一层，它服务的行为票是哪张？
4. 分支能在两天内合回吗？开发加检查会超过一周吗？
5. 未完成部分如何隐藏：toggle、dark launch、branch by abstraction 还是 expand-contract？
6. 这片的核心复杂度是什么？哪些 Paths、Rules、Data 变体可以延后？
7. 这张票延后或丢弃会怎样？如果无影响，它是否该存在？
8. 它是否同时改结构和行为？

## 反例（汇总）

- "后端 API 全部完成"票，验收是接口文档，没有调用方。
- "前端页面"票依赖尚未存在的接口，只能用 mock 演示。
- 一张票三周，分支期间 main 已经变了 200 个 commit。
- 小票都合入了，但约定攒到月底一起上线和测试。
- toggle 的删除没有票，半年后没人知道它能不能关。

## 可保留例外（汇总）

- Spike：产出答案，不产出生产代码，有时间盒。
- 纯结构票：不改行为，独立合入，紧挨着它服务的行为票。
- Branch by abstraction 或 parallel change 的中间步骤：单步没有用户结果，但整串有明确终点和删除旧路径的票。
- 外部约束强制批量 release：deploy 仍小批，release 用 toggle 聚合。

## 拆分判据汇总

以下判据可逐票检查。来源列在括号内；判据组合方式属推断。

1. **可独立部署**：合入 main 后可以部署到生产，不破坏现有行为（DORA small batches、Hodgson latent code、Sato parallel change）。
2. **有可体验结果**：至少一类人（用户、内部人员、canary 群体）能从真实入口触发并看到结果（Cockburn carpaccio "end-user-visible"、Kniberg "Noticeable different"）。
3. **贯穿各层**：触及实现该行为所需的各层，而不是只碰一层（Wake 分层蛋糕、Humanizing Work vertical slice）。
4. **先骨架后加厚**：第一片是 walking skeleton，横跨 backbone；后续片加厚，不先做深一列（Cockburn、Patton）。
5. **价值递增**：每片比上一片对客户更有价值；强制规则先于可选增强（Kniberg）。
6. **尺寸上限**：开发加检查不超过一周，目标数小时到两天；分支寿命不超过约两天（DORA、trunkbaseddevelopment.com）。
7. **INVEST**：Independent、Negotiable、Valuable、Estimable、Small、Testable 逐项可答（Wake）。
8. **可延后可丢弃**：拆法能暴露低价值部分，使其被延后或删除（Humanizing Work）。
9. **结构与行为分离**：一张 PR 只含一种变更（Beck）。
10. **隐藏有期限**：用 release toggle 的票写明删除时间，并有对应删除票（Hodgson）。
11. **整体形状可见**：所有切片挂在 story map 或 use case 上，能看出完成后是"整头大象"（Cockburn、Patton）。

## 反模式

- **横切分层（horizontal slicing）**：按数据库、API、UI 分票。单张票满足 Small，但不满足 Independent 与 Valuable（Humanizing Work、Wake）。
- **按技术组件拆**：一张票一个服务或模块，等全部完成才能联调。价值和集成风险都推到最后（推断，依据同上）。
- **先做完所有基础设施**：先建全套 schema、框架、流水线再写功能。违背 walking skeleton "need not use the final architecture" 与"architecture and functionality evolve in parallel"（Cockburn）。
- **长寿分支**：超过约两天的 feature branch，或多人共享开发分支（trunkbaseddevelopment.com、DORA 三个以内活跃分支）。
- **"最后集成"票**：单列一张"联调"或"集成"票。DORA 明确反对 integration phases 和 code freezes。
- **无业务结果的票**：既不是服务某行为票的结构票，也没有可体验结果，例如"优化代码结构"、"补充工具类"（推断，依据 Wake Valuable 与 Beck 结构服务行为）。
- **小票攒批**：小票合入后又攒成一次大发布（DORA 常见陷阱 "regrouping the batches"）。
- **只切尾巴**：每片很薄，但没有整体地图，切到核心时尺寸骤增（Cockburn 关于"象身"的警告）。

## 未合入 main 前不可见的工作如何处理

原则：不让未完成工作留在分支上，而是合入 main 并部署，再用以下手法控制可见性或分阶段迁移。选择规则属推断，依据各来源的适用描述。

| 手法 | 适用条件 | 不适用 | 收尾票 |
|---|---|---|---|
| **Release toggle（feature flag）** | 新的用户可见功能分多片完成；需要先部署、后 release（[Hodgson](https://martinfowler.com/articles/feature-toggles.html)） | 改动是替换内部实现或改接口；toggle 预计存在远超一两周 | 打开 toggle、删除 toggle 与旧路径 |
| **Dark launch** | 新的或改动的后端行为要在公开前评估负载、性能；它增强已有交互，而不是依赖用户主动选择（[Fowler](https://martinfowler.com/bliki/DarkLaunching.html)、[DORA](https://dora.dev/capabilities/working-in-small-batches/)） | 依赖用户选择的功能，改用 canary release；有不可撤销副作用（扣款、发消息）的调用 | 公开 release，删除 dark 路径的开关 |
| **Branch by abstraction** | 大规模替换内部组件（库、存储、框架）；耗时数天以上；很多调用方依赖旧代码（[Fowler](https://martinfowler.com/bliki/BranchByAbstraction.html)、[Hammant](https://trunkbaseddevelopment.com/branch-by-abstraction/)） | 调用方很少、改动当天能完成 | 删除旧 supplier，必要时删除抽象层 |
| **Parallel change（expand-contract）** | 向后不兼容的接口、方法签名或数据库 schema 变更；调用方需要逐步迁移（[Sato](https://martinfowler.com/bliki/ParallelChange.html)） | 只有一个调用方且可原子修改 | contract：确认无调用方后删除旧接口或旧列 |

组合规则（推断）：
- 内部替换用 branch by abstraction；接口或 schema 变更用 parallel change；两者都不改变用户可见行为。
- 用户可见的新功能用 release toggle；需要先验证负载时叠加 dark launch。
- 每种手法都有收尾票。没有收尾票的隐藏手法会变成永久的第二条路径。

## 研究限制

- Cockburn 作者站当日返回人机验证页；walking skeleton、Elephant Carpaccio 和练习页均改读 Wayback 存档原文（2008、2010、2017 快照）。现行页面是否改动：Unknown。
- 《The Pragmatic Programmer》只核验官方 tip 页；书中 tracer code 正文：Unknown。
- Story Splitting Flowchart PDF 已下载，但未提取文本；流程图逐步内容：Unknown。
- Patton 2014 年书中 "release slice" 的原文措辞、Denne 与 Cleland-Huang 书中 MMF 的逐字定义、《Tidy First?》第 16 章正文：Unknown。
- Cohn SPIDR 页面显示 2026 年更新；原始发布日期：Unknown。
- 本文的拆票启发式未在真实拆票中验证。
