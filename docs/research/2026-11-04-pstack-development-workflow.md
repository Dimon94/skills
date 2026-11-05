# pstack 开发工作流调研：拆票、审查与 CI

职责：一手资料调查与 retro 环境改进候选。日期：2026-11-04。建议均未生效；本次不改运行 Skill、不建 Issue、不提交。

## 结论

值得借鉴 pstack 的是**让交付单元绑定可复跑证据、让发现项按实际影响分流、让复验范围随变更变化**。不建议整套引入 poteto-mode。它也有明显的重流程默认值：最新多 PR 计划要求每 PR 十条 live lane、unit 和 perf 验证，Feature 默认进入设计探索与实施委派；这些是提示词要求，不是已证明划算的自动化。[P1][P2]

对三个痛点的判断：

1. **拆票与最后约 20% 的缺口：** 优先让现有 `to-tickets` owner 使用本仓已有的业务主线、walking skeleton、验收落片与真实依赖判据；先把第一片从实现带到真实入口验收，再决定后续细分。pstack 的「先跑完一个单元再展开」可借鉴，但它没有自动判定票粒度正确的能力，也没有长周期完成率收益的实证。[P3][P4] 用户描述的“约 80%”是本次问题输入，未取得历史任务样本复算，根因 Unknown。
2. **Review、测试与防护太重：** 借鉴 `fix / dismiss / ask`、同根因合并、修复后针对变更复核、无新增证据时换诊断。保留真实安全、隐私、授权、资损、数据丢失及迁移问题的阻断能力。pstack 第三轮起倾向排除已证明的低风险噪声，并不等于第三轮后通过；本地 ADR 已明确不设真实 bug 修复轮次上限。[P5][P6][L6]
3. **CI/CD 慢：** pstack 直接支持的主要是少做无效 push、rebase、盲重试与轮询；没找到它为目标项目实现依赖缓存、变更影响测试选择或 CI DAG 调度的证据。先测目标业务项目的 critical path，再选优化。业务项目的实际耗时、失败率、缓存命中率与收益均为 Unknown。[P5][P7][P8]

本仓已改写引入 `blast-radius`、`create-verification-skill` 等 pstack 机制；再安装同名机制收益有限。更有价值的候选是接好已有入口、复用有效证据，减少重复判定。[L1]

上游 README 明说作者不把规划作为默认，称“the best spec is code”，需要时使用 Cursor plan mode 或 poteto-mode 的计划分支。[P22] **推断：** pstack 更适合作为执行与取证机制的参照，不能视作已经解决 to-spec/to-tickets 粒度问题的规划系统。

## 来源版本、读取范围与证据强度

### 版本

| 来源 | 本次实际版本与获取方式 | 能支持的结论 |
| --- | --- | --- |
| `cursor/plugins` 官方仓库 | `gh api repos/cursor/plugins/commits/main` 返回 `180939f9e59cc9512e9330649175763e81fad16f`，commit 时间 `2026-11-04T03:25:26Z`；以下 pstack 源文件均从该 SHA 的 raw URL 读取。[P0] | 此版本的明文合同、脚本行为。不能证明模型每次遵循合同。 |
| GitHub Actions 官方文档源码 `github/docs` | main 为 `4a20c763a48bd4f5a34a84c002fd9858e9793f65`，commit 时间 `2026-11-03T23:27:15Z`；读取 workflow syntax、缓存、concurrency、路径过滤及对应 reusable。[G0] | GitHub 平台能力。不能算作 pstack 实现或本地已启用配置。 |
| `my-skills` 本地 | `main`，HEAD `89bf7a32cc26808e6aba94215549297b03af6bc6`；读取本次工作区文件 | 当前源码合同；不证明各项目实际执行。 |
| 外部链接依赖 | `to-spec`、`to-tickets`、`implement`、`retro` 实际指向 `mattpocock-skills` clone，HEAD `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`；所查 `to-spec`、`to-tickets`、`retro` 文件无本地 dirty | 运行时可见合同。`sources.json` 只列上游快照，不能用其中的旧 mattpocock SHA 代替链接依赖实际 HEAD。 |
| `delivery-pipeline` 本地 | HEAD `4481362536fbcb45e8a016b1d4d7c79f454c35b7`；定向读取 sizing、gate、ADR 与 validate workflow | 已有责任边界、不能重复增加的 gate。 |

### 实际读取范围

只列与本题直接相关的范围，未泛读其他插件，也未用 gstack 替代 pstack。

- **发现与路由：** 定向查阅 pstack README、`agents/poteto-agent.md`、`poteto-mode/SKILL.md`，检索 guide 的验证发布与 pitfalls 相关段落；树清单用于确认套件文件分布。[P0][P1]
- **规划与长任务：** `multi-phase-plan`、`orchestrate`、`feature`、`prototype`、`autonomous-run`、`autopilot-full`；`principle-sequence-verifiable-units`；`check-plan.mjs` 及其测试。[P2][P3][P4][P7][P9][P10]
- **审查与验证：** `babysit`、`shipping`、`opening-a-pr`、`bugbot-triage`；`blast-radius`、`tdd`、`interrogate`；生成/维护普通验证 Skill、生成形式化验证 Skill、测试行为/边界纪律/质疑前提原则、benchmark checklist；`reflect`。[P5][P6][P8][P11][P12][P13][P14][P15][P16][P17]
- **确定性实现：** 阅读 `watch-pr` 的 `cli.ts` 与 `policy.ts` 相关实现，确认单 PR/stack 的 pending、blocker、ready 分类和 CLI 调用。`github.ts`、`types.ts` 已下载作为旁证，未完整审计；未运行 watcher 访问实际 PR，未执行合并，未跑其完整测试套件。[P18][P19]
- **最小本地对照：** CONTEXT、写作/开发/质量规范、README、code-review、epic-planner、vertical-slicing、既有垂直切片研究、ADR-0002、来源清单；运行时 to-spec/to-tickets/implement/retro/ticket-sizing；pipeline gate 与 ADR-0012。[L1][L2][L3][L4][L5][L6][L7][L8]

### 运行验证

在 `/tmp/pstack-research-20261104/` 保存定向下载材料；未将上游代码安装进运行时。

| 检查 | 结果 | 解释 |
| --- | --- | --- |
| `bun test /tmp/pstack-research-20261104/pstack/skills/poteto-mode/scripts/check-plan.test.ts` | `7 pass / 0 fail / 25 expect()` | 仅证明本机该版本计划格式检查测试通过，不是端到端流程验证。 |
| `node …/check-plan.mjs …/shape-only-plan.md` | exit 0，`1 PR sections, 0 problems` | 从上游测试 fixture 重建的计划含 `Do the thing`、`Check the thing`、`Pass when evidence exists`，仍通过。该检查不验证验收语义。 |
| 同一 fixture 删除 Lane 10 后运行 | exit 1，报告 `expected 1 to 10` | 证明 lane 数量是实际执行的格式约束。源码与原 fixture 均可独立核对。[P4][P23] |
| `gh run list --repo Dimon94/delivery-pipeline --limit 8 --json databaseId,workflowName,status,conclusion,createdAt,startedAt,updatedAt,event` | 成功，结果见 CI 节 | 只读运行证据，未触发新 workflow。 |

**证据边界：** 本次 retro 以当前会话的用户反馈、工作区文件和运行时合同为范围，未审计其他开发会话。Skill 中的“应当并发”“应当验证”均是上游明文指令。实际自动执行需要宿主能力、配置与 agent 遵循。除上述小检查外，未实测 pstack 的全链路、完成率、成本或耗时；本报告不声称它提高完成率或缩短 CI。

## 三项问题映射

### 1. 拆得过细、过粗，最后仍需人为补齐

| pstack 明文机制 | 可借鉴与适用条件 | 不应照搬或证据限制 | 本地已存在的对应机制 |
| --- | --- | --- | --- |
| 一个 PR 是一个有自己证据的变更；计划记录依赖、Files、Build、You see、unit/live/perf、review gate、merge。[P2] | 票在分派前就能回答“谁从什么入口得到什么结果，凭什么算完成”；依赖写成可用 Interface/能力。 | 全套模板重。十条 live lane 与 perf 是固定成本，不应成为所有票的默认验收。 | `to-tickets` 已要求完整垂直路径、独立可演示与真实 blocking edges；sizing 已要求独立验收、单 worktree 和 prereq check。[L2][L3] |
| 协调者的 kickoff 必须给完成证据；说不出证据说明单元尚未定界；先带一个单元走完 owner、verifier、merge 再展开。[P3] | 用第一片校准 scope、启动环境、测试与审查成本，再推广到相似票。 | “先一个”是行为建议，不能凭提示词证明每次执行；不需要为每张微小票都创建复杂协调层。 | `vertical-slicing` 已有 walking skeleton、真实入口、验收逐条落片；`epic-planner` 已保留迷雾，避免把未知提前固定成地图。[L4][L5] |
| 开放问题先 prototype，再写多 PR 计划；逐单元验证后才推进。[P2][P9] | 技术可行性、权限/环境是否可用等会改变拆分的问题，先用最小探针回答；产品取舍仍需真实用户决定。 | 不要求所有票先原型；已有可信证据不重复探针。 | 本地 sizing 已有能力 prereq check；垂直切片也已允许 spike。[L3][L4] |
| `check-plan.mjs` 检查字段、顺序、lane 编号、截图与 `Pass when` 字样。[P4] | 可学习“机械缺失交给代码”：缺 ID、缺引用、缺证据字段等。 | 它不证明路径存在、依赖真实、用户价值完整、证据已产生，也不证明票过大/过小。 | pipeline 已有 tickets gate 与实施前置校验。不要再加 coordinator 主观粒度 gate。[L7] |

**推断：** 用户说的“约 80%”可能同时包含漏掉验收、集成后才暴露依赖、真实环境不可达、以及开发完成被当作用户结果完成。没有历史任务证据，不能选一个当根因。改进实验应分别统计这些缺口。

**本仓建议：** 粒度以可观察闭环判断。只有一段 DTO 或一个按钮但无法体验的票往往过细；“整个退款系统”包含多个独立业务结果且结束条件模糊，往往过粗。行数、token 预测和预计耗时只提示容量风险，不能证明正确性，也不能靠固定阈值自动决定票数。

### 2. Review 多轮，测试和边界防护越来越复杂

| pstack 明文机制 | 可借鉴与适用条件 | 不应照搬或证据限制 | 本地已存在的对应机制 |
| --- | --- | --- | --- |
| Bugbot 先分 `fix / dismiss / ask`；dismiss 必须是已记录的低风险模式且当前代码可证明；安全、数据、迁移、并发等不能靠历史相似自动跳过。[P6] | reviewer 报告事实与影响，owner 处理噪声时提供反证；高风险未知保持待证实或升级。 | “第三轮倾向 dismiss”只针对已证明噪声，不是轮次上限；未知安全问题不因难复现消失。[P5][P6] | 本地质量规范已有具体场景、影响与证据，P3 为不破坏行为的清晰度问题；缺的是统一 blocker 映射。[L8] |
| Interrogate 要求真实运行支持发现项，由协调者复跑并合并同根因项。[P11] | 让可复现的 correctness 争议先跑最小检查；同根因项共享一次修复，Standards/Spec 仍分别保留本轴依据与结论。 | 不把“必须跑出 exploit 才能阻断”用于安全审查。凭源码即可证明的授权缺失，或环境限制下未能安全验证的高影响风险，仍需处理。 | 本地 Standards/Spec 独立，修复后只复核受影响轴/范围，已有固定证据快照与独立 verdict 要求。[L9] |
| 完整 swarm 在 code-ready head 跑一次；新增行为、重设计或大 diff 才再次完整运行；小修复/rebase 用单 verifier，纯措辞不跑 swarm。[P7] | 根据实际语义变化决定复核成本；明确旧证据覆盖什么，哪些已失效。 | 不能把“纯措辞”当通用免检：运行 Skill、协议、权限或安全策略文案也可能改变行为。它只免除上游说的 swarm，不免除所有检查。 | 本地 code-review 已规定 delta 复核；不需要再建一套审查协议。[L9] |
| TDD 明确只在廉价测试入口存在或显式要求时使用；无合适路径用最近可执行验证；不要为了小修复建庞大 fixture/mocks。[P12] | 优先最近 public interface 的回归检查；验证错误实现会失败。 | 不以“不加新测试”解释为“无需证据”；本地缺陷修复的先失败后通过合同仍有效。 | 本地规范已默认 1 条主路径，必要时 1 条关键失败路径，禁止新增不必要框架。[L8] |
| blast-radius 找一两个安全成立的关键事实，运行真实代码证明；边界纪律把校验集中在外部输入边界。[P13][P14] | 防护从明确攻击/失败路径倒推，证明上游已校验后删除内部重复校验。 | 类型断言不是运行时授权；身份、资源归属和异步状态变化可能形成新的信任边界。不能借“内部可信”删掉这些检查。 | 本仓已拥有 blast-radius，根约束已有边界校验一次。无需再安装相同 Skill。[L1] |

pstack 也有可能放大成本的机制：函数边界触发 architect，存在多个实现形状时 Feature 强制 arena，评审前 no-comments，以及多 PR 默认十条 live lane。[P1][P2][P24] **推断：** 对日常有明确方案的小改动整体引入，可能比当前链路更重。这里没有实际成本数据，不能断言慢多少。

### 3. CI/CD 慢

pstack 确实写明：把已知修复合成一个 push wave；只处理当前 merge frontier；先归类 CI 失败再重跑；flake/基础设施只允许一次 fresh build；减少无必要 rebase，因为每次会重启 CI；新 head 仍需自己的 green CI。[P5][P7] 这些是执行纪律，已读取的 watcher 是状态读取与分类代码，不负责加速 build/test。[P18][P19]

Shipping 允许在 `patch-id` 与明确 build 等价证据下保留部分旧 lane 结果；测试/文档/lint 修改本身仍需新检查和 review，无 build 产物可比较的 lane 要重跑。[P8] **本仓建议：** 只借鉴“证明覆盖仍有效才复用”。相同 patch-id 并不单独证明依赖、环境、base、锁文件或外部协议没变。

GitHub 平台另外提供缓存、concurrency 和路径过滤，这些不是 pstack 的实现。[G1][G2][G3] 是否适用由目标项目的实测瓶颈决定。

## 本地事实：先复用责任边界

1. README 把大需求路由到 `wayfinder → delivery-pipeline`，小需求才经过 `to-spec → to-tickets`。不能把一切大需求问题归因为“小需求模板缺字段”。[L10]
2. `vertical-slicing` 是显式调用，已有业务主线、walking skeleton、验收落片、依赖按 Interface/能力连边，以及 `ticket_release` 交接；未看到 README 主路径把它默认接入 to-tickets。这里是接入候选，不是需要新造切片 Skill。[L4][L10]
3. `ticket-sizing` 已强制主动 token 预测、独立验收、prereq check。tickets gate 已要求 sizing 产物和用户确认；gate 证据齐全后，coordinator 不得再按主观粒度拦 dispatch。[L3][L7]
4. pipeline 默认存在整图 testing/review 与 summary MR；独立票 `ticket_release` 跳过 whole-map gates，但保留单票生命周期。只有真实可独立交付的票才适合该模式；仍有跨票集成未知时不能只为省检查切换。[L4][L7]
5. `implement` 的 full suite once at end、code-review，与 pipeline 后续 whole-change testing/review/remote 形成潜在重复；现有源码不能证明它们测试的是相同产物或已经构成瓶颈。[L7][L11] 本地已有“格式提交守卫”Open 记录，不重复提出同名新事项。[L12]

## 五项改进候选，按优先级排序

以下是待批准的环境改进方案，不是新增合同。每项都落在已有 owner 内；不增加第三道粒度 gate。

### 1. 在现有 Spec/tickets 产物里把验收结果与真实旅程对应起来

- **原因：** 票全关并不等于用户的目标成立。优先解决“最后才发现主线没打通”，而不是先优化票数。
- **证据：** pstack 的 kickoff 需要具体完成证据，并先完成一个完整单元；本地 vertical-slicing 已要求每条验收落片，epic-planner 区分规划完成、实现完成和集成验证。[P3][L4][L5]
- **最小改法：** 在已有 Spec/tickets owner 产物中，为每条已接受的验收标注所属业务旅程、交付票、最终入口和证据位置。第一片必须能从真实入口完成核心闭环；每片完成后更新该旅程证据。明确延后的验收由用户批准，不靠悄悄缩范围提高完成率。沿用已有 artifact，不维护平行状态台账。
- **可观测验收：** 试用一个实际需求。收口时所有 in-scope 验收都有对应当前产物的成功证据；未达标则明确未完成/blocked。保留用户首次验收发现的漏项数、需要人为补代码/接线的次数和原因，作为后续对比基线。当前基线 Unknown。

### 2. 在 to-tickets owner 内接入已有垂直切片判据，并用第一片校准

- **原因：** 只问“粒度感觉对吗”依赖用户预判；只估 token 也不能判断用户结果是否完整。
- **证据：** to-tickets 已有垂直切片与用户批准，sizing 已有合并/拆分与 prereq check；本地 vertical-slicing 目前显式调用。pstack 则要求先用原型消除影响规划的未知，再以一个单元检验 kickoff。[L2][L3][L4][P2][P3]
- **最小改法：** 在本仓可控的 pipeline owner packet/路由中，给存在拆分歧义的大 Spec 或既有票粒度审查附上 vertical-slicing 指针，仍由同一个 to-tickets owner 形成结果并获批。不手改上游链接依赖，不增加 coordinator 粒度审查。把第一片的真实耗时、重复上下文、暴露依赖与验收难点反馈给后续尚未 claim 的票；已派发票按现有所有权处理。会改变边界的未知先做带问题与退出条件的探针。
- **可观测验收：** 每条阻塞边能说出具体 Interface/能力及就绪证据；相邻细票若各自无法独立验收则能提出合并理由；粗票若有多个独立结果则能提出分片。对同一个样例，能解释保留、合并或拆分，而不是仅报票数或 tokens。记录批准后因粒度错误返工的次数。只有满足独立发布条件时才评估现有 `ticket_release`。

### 3. 给现有 Review 增加清楚的 blocker 处置语义，持续修复但缩小复核范围

- **原因：** severity 有定义，仍缺统一的“什么阻断本次交付”映射；不同轮次容易把偏好、历史欠账与新回归混在一起。
- **证据：** pstack 把真实问题、可证伪噪声、高风险未知分开；autopilot-full 区分本次引入/新触达的问题和 base 已有问题。[P6][P7] 本地质量规范 P3 不破坏行为，但延后条款引用了根 AGENTS 中不存在的 `<stage>`，不能靠这个缺失入口稳定决定去向。[L8] `code-review` 已允许复核受影响轴/范围，`gh-merge-pr` 却规定 head SHA 变化使整个 Packet 与 Review 失效；当前合同没有统一说明重建 Packet 后能复用哪些结论。[L9][L14]
- **最小改法：** 在质量规范的现有 finding/严重度位置补处理映射，并修正失效的 `<stage>` 指针，code-review 只引用它。finding 附 `blocker / non-blocker / needs-evidence` 与理由，不把 P0-P3 机械等同处置。保留 Standards/Spec 独立结论。统一 code-review 与 gh-merge-pr 的复核规则：新 head 仍需新 Packet 和独立结论，修复交回 changed head、修复 diff、已处理 finding ID；由 reviewer 检查受影响轴及邻接风险，并说明哪些旧证据对新版本仍有效。新增范围说明新依据。同一失败反复出现但无新证据时换诊断并测试共同前提，不更改验收标准。[P15][L9]
- **可观测验收：** 用下节样例复核，所有真实安全/数据阻断项仍保持阻断；P3 偏好不导致无止境实现改写。每轮能说明新增证据、已关闭发现和剩余阻断；无真实问题时收口。继续遵守 ADR-0012：有真实 bug 就修，直到原判据通过，不设“两轮后 PASS”。[L6]

### 4. 复用已有证据快照，按风险选择最小充分验证

- **原因：** 节省的应是同一产物的重复验证，不是关键失败路径。格式齐全的计划也可能没有任何真实行为证明。
- **证据：** pstack 已区分 full swarm 与小修复复核；普通验证 Skill 提供 Launch/Doctor/Drive/Evidence/Cleanup 与 feature map；blast-radius 聚焦关键安全事实；本地已有对应 Skill 和 Review Evidence Bundle。[P7][P13][P16][L1][L9]
- **最小改法：** 复用现有验证报告，明确 base/head 或产物 hash、命令、环境/依赖与结果，供 implement、集成、review、remote 识别是否已覆盖当前问题。focused 检查保障本片；跨票行为交给必要的集成检查；涉及授权、并发、幂等、迁移等再补具体失败路径。目标项目已有 verify Skill 就复用；确实没有可驱动真实入口时，再使用已有生成入口打通一个主线并证明能运行。不引入固定十 lane/perf，不让所有 PR 都跑全 feature map 维护流程。
- **可观测验收：** 选一次真实交付，能列出每条测试/审查命令保护的行为；被省略的重复运行有相同产物与覆盖有效的证据；修复引入的新行为有新验证。统计重复命令耗时和 reviewer 读取量。任何授权绕过、重复副作用或数据破坏的目标错误实现仍能被相应检查拒绝。

### 5. 先测 CI critical path，再只改最大可解释瓶颈

- **原因：** 减少 workflow 次数、减少单次耗时、缩短等待部署时间是三个不同目标。先知道用户等在哪里。
- **证据：** pstack 提供 batch push、失败归类与减少 rebase；benchmark checklist 要求识别限制因素并同时看用户等待的端到端路径。[P5][P7][P17] GitHub 的缓存、concurrency、path filtering 是可选平台能力。[G1][G2][G3]
- **最小改法：** 在目标业务项目读取最近至少 20 次相关 run 的 job/step 数据，分开成功/失败、PR/main、冷/热缓存；记录提交后排队、安装、构建、测试、artifact、部署等待和验证，画出 `needs` 依赖的最长路径。一次只选一个有数据支撑的调整，比较修改前后相似样本。若平台不是 GitHub，映射到该平台能力，不直接复制 YAML。
- **可观测验收：** 报告 p50/p95 的定义、样本数、失败率、关键 job、重跑原因与最终目标；优化后减少的等待能由阶段变化解释，结果及安全/发布门槛保持有效。未拿到这些数据前不承诺“快一半”。

## blocker 与 non-blocker 的实用判断

以下是本仓建议的审查判定例子，不是 pstack 已实现的自动分类器。

| 场景与证据 | 建议处理 | 边界 |
| --- | --- | --- |
| 新下载接口只校验登录，租户 B 的已认证用户能读租户 A 的文件；源码路径明确或最小请求复现 | **blocker** | 增加资源归属检查并验证跨租户拒绝。即使第十轮才发现仍必须修。 |
| 退款/消息重试在超时后再次执行副作用；受控调度复现重复扣款/发送 | **blocker** | 幂等是当前行为合同，不能作为“边缘 case”延后。 |
| 新迁移先删列、仍有线上版本读取该列；调用方和部署顺序可证 | **blocker** | 需要可行的迁移顺序与数据保护证据；代码小不代表风险小。 |
| Bot 要给内部非空值再加一层 null guard，边界解析和 typed value 已强制该不变量 | **non-blocker，可 dismiss** | 给出边界检查与值来源；若跨异步状态变化可能失效，则该反证不成立。 |
| Reviewer 建议把一个单调用 helper 再抽象一层，没有当前行为缺陷或明确合同要求 | **non-blocker** | 属判断性建议，不以代码改动换安静。 |
| Bot 报某 export 未用，后续已存在的 stack diff 确有消费者 | **non-blocker，仅清除“未用”发现** | 消费者未合入的依赖仍需明确；不能凭此声称当前票可独立发布。[P6] |
| CI 在 base 同场景已失败，本次未修改或新触达相关路径 | **本次回归 non-blocker，发布状态另判** | 记录 base 证据。必需 CI/环境仍不可用时保持交付 blocked，不能绕过门槛。[P7] |
| 安全扫描提报高风险依赖路径，尚不能确认可达，测试环境又缺必要身份 | **needs-evidence；高影响发布保持 blocked** | 定向查版本、调用路径与权限；“没复现”不足以 dismiss，也不能擅自执行生产攻击。 |
| 已确认资损问题被写入 follow-up | **仍为 blocker** | 记录位置不改变真实风险，owner 的“以后再做”不能替代修复或真实范围决定。 |

**停止条件建议：** 当前 head 的所有交付 blocker 已解决，必要验证与独立 verdict 覆盖新版本，且无未处置的高影响未知项时收口。可以停止无证据扩张和重复噪声；不能停止仍有真实 bug 的修复。外部权限或环境确实无法解除时写 blocked 与恢复条件，不写 PASS。

## CI：现有样本与条件式优化

### 框架自身的样本

本次复核 `Dimon94/delivery-pipeline` 最近 8 次 `validate` run。按返回顺序的 `startedAt → updatedAt` 为 **39、32、39、62、69、32、35、28 秒**；2026-09-27 至 2026-10-29，7 success、1 failure。例：[39 秒 success](https://github.com/Dimon94/delivery-pipeline/actions/runs/40834726876)、[39 秒 failure](https://github.com/Dimon94/delivery-pipeline/actions/runs/40717444638)、[69 秒 success](https://github.com/Dimon94/delivery-pipeline/actions/runs/38888463699)。workflow 当前主要执行 `python3 scripts/validate.py`。[L13]

这是 run 生命周期的近似，可能包含 runner 等待、收尾等；不是纯测试时间、逐 job 时间或提交到部署的 lead time。另查最新一次的 [job 123316730972](https://github.com/Dimon94/delivery-pipeline/actions/runs/40834726876/job/123316730972)，`Validate bundle` 步骤从 `07:19:55Z` 到 `07:20:23Z`，耗时 28 秒。此样本不能解释业务项目 CI/CD 慢，也不能推广到其他项目。`my-skills` 本仓没有 `.github` workflow；其守卫缺口已经登记，和慢 CI 是不同问题。[L12]

### 只有命中对应瓶颈才采用

| 测量结果 | 条件式最小优化建议 | 必须验证的边界 |
| --- | --- | --- |
| 同一 PR 旧 head 的 CI 占用资源，新 head 排队 | 同 workflow、同 PR 使用 concurrency group，并对可安全取消的验证 run 设置 `cancel-in-progress: true`。这是 GitHub 平台能力。[G1] | 不把其他 PR 误分同组；不直接取消已开始的不可安全中断部署、迁移或外部写入。 |
| 下载依赖是主要 critical path | 缓存包管理器下载内容；key 覆盖 OS、运行时/工具链及锁文件。官方支持 key/restore-keys，并提供精确命中的 `cache-hit`。[G2] | 缓存恢复成本、冷/热表现与正确性均实测；仍执行正确安装/校验。缓存不含密钥，低信任输入不可污染可信运行。[G4] |
| 不相关模块改动仍跑昂贵测试 | 在有准确影响边界时路由受影响检查；共享库、锁文件、构建/测试配置变化扩大验证。GitHub `paths`/`paths-ignore` 只按变更路径触发，不是语义依赖分析器。[G3] | 必需 workflow 被路径过滤跳过会留下 Pending 并阻断合并；保留稳定的必需结果。大 diff 的过滤限制也须核对，不能靠未触发当“绿”。[G5][G6] |
| 独立测试 job 被无必要串行依赖限制 | 在目标项目检查 `needs`，并发真正独立的 job，或按隔离程度分片 | 并发资源/启动开销可能抵消收益；共享数据库、端口或状态不能无隔离并发。此项是本仓建议，不声称 pstack 已实现 CI 分片。 |
| 多次小 push、rebase、盲重跑消耗总等待 | 采用一个已知修复 push wave；重试前区分代码、base、基础设施和 flake；不为每个无关 trunk 变化重启整条验证。[P5][P7] | 新 head 与实际 merge result 仍需有效验证；一个真实失败不能被“再试一次”覆盖。 |

## 不采纳的方向与剩余未知

- **不整套替换为 poteto-mode。** 固定 lane、默认设计竞争和广泛授权假设不等于适配本仓的最小方案。[P1][P2] 本仓的远程写授权和 canonical owner 保持原合同。
- **不再创建 sizing Skill 或第三道粒度 gate。** 现有 owner、产物与 gate 已明确。[L3][L7]
- **不以硬轮次上限代替真实修复。** pstack 的 worker 重试次数、Bugbot pass 启发式与本地验收修复是不同对象；本地持续修复决定优先。[P3][P5][L6]
- **不把形式化验证普遍化。** 上游要求选择高危且测试难覆盖的一条属性，披露模型/边界/假设，并证明错误变体会失败；它不是所有改动的额外 gate。[P20]
- **不把 reflect 的写入流程带入本次 retro。** pstack reflect 还含后台审查、待办发布与批准后 Skill 编辑；本次授权止于研究，未执行这些动作。[P21]

目标业务项目 CI 的 critical path、review 各轮发现构成、额外防护的真实误报成本、历史漏项分布、以及当前每个项目 verify Skill 的可运行性均为 **Unknown**。需要相应项目的代码和运行数据才能从候选中选择落地项。此次最有信息价值的下一步，是选一个实际需求，复用现有 owner 跑通第一片，并同时收集验收漏项、复验和 CI 阶段数据。

## 来源坐标

外部源码链接均固定到本次读取的 commit；行号对应原始文件。运行记录链接指向实际 run。

[P0]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/README.md#L1-L43
[P1]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/SKILL.md#L13-L37
[P2]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/multi-phase-plan.md#L3-L15
[P3]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/orchestrate.md#L3-L23
[P4]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/scripts/check-plan.mjs#L128-L205
[P5]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/babysit.md#L5-L21
[P6]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/references/bugbot-triage.md#L5-L84
[P7]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/autopilot-full.md#L5-L20
[P8]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/shipping.md#L5-L10
[P9]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/principle-sequence-verifiable-units/SKILL.md#L7-L17
[P10]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/autonomous-run.md#L3-L11
[P11]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/interrogate/SKILL.md#L9-L31
[P12]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/tdd/SKILL.md#L7-L34
[P13]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/blast-radius/SKILL.md#L13-L46
[P14]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/principle-boundary-discipline/SKILL.md#L7-L34
[P15]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/principle-attack-the-premise/SKILL.md#L7-L19
[P16]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/create-verification-skill/SKILL.md#L11-L40
[P17]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/benchmark-checklist/SKILL.md#L9-L34
[P18]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/scripts/watch-pr/policy.ts#L59-L235
[P19]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/scripts/watch-pr/cli.ts#L82-L150
[P20]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/create-formal-verification-skill/SKILL.md#L9-L39
[P21]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/reflect/SKILL.md#L23-L60
[P22]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/README.md#L269-L279
[P23]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/scripts/check-plan.test.ts#L7-L69
[P24]: https://github.com/cursor/plugins/blob/180939f9e59cc9512e9330649175763e81fad16f/pstack/skills/poteto-mode/playbooks/feature.md#L5-L19
[G0]: https://github.com/github/docs/commit/4a20c763a48bd4f5a34a84c002fd9858e9793f65
[G1]: https://github.com/github/docs/blob/4a20c763a48bd4f5a34a84c002fd9858e9793f65/data/reusables/actions/actions-group-concurrency.md#L7-L42
[G2]: https://github.com/github/docs/blob/4a20c763a48bd4f5a34a84c002fd9858e9793f65/content/actions/reference/workflows-and-actions/dependency-caching.md#L24-L73
[G3]: https://github.com/github/docs/blob/4a20c763a48bd4f5a34a84c002fd9858e9793f65/data/reusables/actions/workflows/triggering-a-workflow-paths1.md#L1-L13
[G4]: https://github.com/github/docs/blob/4a20c763a48bd4f5a34a84c002fd9858e9793f65/content/actions/concepts/workflows-and-actions/dependency-caching.md#L30-L36
[G5]: https://github.com/github/docs/blob/4a20c763a48bd4f5a34a84c002fd9858e9793f65/data/reusables/actions/workflows/triggering-a-workflow-paths2.md#L10-L12
[G6]: https://github.com/github/docs/blob/4a20c763a48bd4f5a34a84c002fd9858e9793f65/data/reusables/actions/workflows/triggering-a-workflow-paths5.md#L1-L14
[L1]: ../../skills/sync-upstream-skills/references/adapted-sources.md
[L2]: /Users/dimon/.agents/skills/to-tickets/SKILL.md:23
[L3]: /Users/dimon/01-Personal/10-Projects/delivery-pipeline/skills/ticket-sizing/SKILL.md:12
[L4]: ../../skills/vertical-slicing/SKILL.md
[L5]: https://github.com/Dimon94/skills/blob/89bf7a32cc26808e6aba94215549297b03af6bc6/skills/epic-planner/SKILL.md
[L6]: /Users/dimon/01-Personal/10-Projects/delivery-pipeline/docs/adr/0012-acceptance-circuit.md:7
[L7]: /Users/dimon/01-Personal/10-Projects/delivery-pipeline/skills/delivery-pipeline/references/gate-state-machine.md:24
[L8]: ../agents/quality-standards.md
[L9]: ../../skills/code-review/SKILL.md
[L10]: ../../README.md
[L11]: /Users/dimon/.agents/skills/implement/SKILL.md:11
[L12]: ../deferred-hardening.md
[L13]: /Users/dimon/01-Personal/10-Projects/delivery-pipeline/.github/workflows/validate.yml:12
[L14]: ../../skills/gh-merge-pr/SKILL.md#1-绑定-review-packet
