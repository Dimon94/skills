# Current System Map

Status: current

本文件描述当前可验证的仓库边界、模块所有权、依赖方向和验证入口。不要写目标愿景冒充现状。

## 当前事实

- 仓库：dverity（个人 skill 库）。
- 阶段：技能维护与迭代。本仓无产品交付阶段；延后加固清单归 repo://docs/deferred-hardening.md。
- 业务目标：Unknown。
- 技术栈：Markdown skill + bash/Node.js 契约脚本，无构建、无框架。
- 运行入口：`skills/<name>/SKILL.md` 由 agent 运行时（Claude Code / Codex / pi 等）读取；脚本由 SKILL.md 显式调用。
- 部署拓扑：无部署；`~/.agents/skills` 与 `~/.claude/skills` 经 symlink 消费本仓。
- 持久状态 owner：skill 文档与脚本本身；运行期状态归调用方项目。
- 外部系统：GitHub（Dimon94/skills 的代码与 PR，以及 repo://skills/sync-upstream-skills/references/sources.json 声明的上游来源）；Linear（本仓 Issue、Epic、Spec 与 ticket 的唯一 tracker，坐标见 repo://docs/agents/issue-tracker.md；另提供 Issue 归档与回读）。
- CI：GitHub Actions 当前未配置，状态为 absent。

## 场景与 ticket 的交接

[共同合同与停止回合样例](../../skills/to-tickets/references/delivery-contract.md)冻结 A02 与 A03 的读写边界。`to-spec` 拥有场景的独立预期，`to-tickets` 拥有票级 T/R 分配。`prepare` 复用 `to-tickets` 的票面解析，核对依赖与现场草案并生成绑定基线的 Brief。`implement` 核对每片落地和预先批准的场景检查，交回 SliceEvidence 或 MmfVerdict。原有规划检查器保留各自的 Markdown 输入与诊断格式。

| 合同层 | 归属与后续接线 | 验证入口 |
| --- | --- | --- |
| L2 规划（A02） | `bdd` 提供场景与证据选择，`to-spec` 和 `to-tickets` 写出 Spec 与实施合同。 | 两个规划检查器、各自的 `references/verification.md` 和共同合同的错票。 |
| L2 执行（A03） | `delegate-ticket` 准备派发合同，`implement` 回交片级证据或 MMF 验收结果，`code-review` 审集成提交。`implement`、`dimon-mode` 与其 `playbooks/bug-fix.md` 从 `tdd` 迁至 `bdd`。 | `stop-turn/briefs.cjs` 中的两片漏项和 `example/check.cjs` 的整票读回。 |
| L3–L5 | `skills/delegate-ticket/scripts/prepare.js` 与 `skills/implement/scripts/implement.js` 冻结调用点。字段及错误见共同合同。 | 以同一 `TURN-1`、`S1` 调用并核对 Brief、SliceEvidence、缺项退回和集成复验。 |
| L6（A03） | 补基线和先例 → 按票收齐各片 → 集成提交对账。缺项交回原 owner。 | 准备单片、多片；在集成提交重跑原场景。 |

A02/A03 的安装目标为 `~/.agents/skills/{bdd,delegate-ticket}` 和 `~/.claude/skills/{bdd,delegate-ticket}`，经 `scripts/link-skills.sh` 与完整开发工作流安装入口生成。`tdd` 已退役，`skills/tdd/` 与安装脚本的退役清理逻辑已删除。改编来源与 ADR 0006 保留历史出处。

当前模块清单：

| Module | Owns | Does not own | Public interface | Depends on | Verification |
| --- | --- | --- | --- | --- | --- |
| skills/best-practice-scout | 技术决策调研编排：本地语境、行业主流方案与盲点识别、针对盲点的跨学科垂直深挖、分场景推荐 | 不拥有代码变更、最终决策或通用调研机制 | SKILL.md | investigate；调用环境的 research 与后台 agent（可用时） | `node scripts/check-skills.js`与人工审查 |
| skills/do-not-repeat-yourself | 复用判定与重复审计 | 不拥有具体实现选择 | SKILL.md | repo://docs/agents/coding-standards.md | 无独立测试，经人工审查 |
| skills/automate-me | 从跨会话证据创建或增量更新独立的 `<handle>-mode`；本仓自有生成器，产物归目标项目与目标使用者 | 不拥有目标使用者的偏好正文、项目规则、任务或项目 Skill、retro/correct 的职责或远程发布 | SKILL.md + agents/openai.yaml + references/verification.md | writing-for-agents；宿主支持的只读跨会话工具；目标项目的规则与 Skill | `node scripts/check-skills.js` + references/verification.md 的隔离场景 |
| skills/dimon-mode | 显式调用的跨项目工作方式入口：硬规则触发、原则叶子索引、自主权、子代理、回复、注释、任务路由、判定规模，以及串联已有 Skill 的剧本：修缺陷、小需求、对标参考产品、暂停、接手会话、写 Skill（ADR 0010、0012、0013） | 不拥有原则正文（归上游快照叶子）、常驻索引（归 AGENTS.md `<principle_index>`）、各阶段流程（归被路由的 Skill）或本仓特有规则（归 AGENTS.md） | SKILL.md + playbooks/{bug-fix,small-change,replicate-reference,pause-safely,session-pickup,authoring-a-skill}.md + agents/openai.yaml + tests/scale-triage.test.mjs | principle-* 快照；被路由的运行时 Skill | 人工审查：原则节与叶子、AGENTS.md、README 一致；路由目标在运行时目录存在。规模分流用 `node --test skills/dimon-mode/tests/scale-triage.test.mjs` |
| skills/herdr-autopilot | 外部宿主（如 T3 Code）对默认 Herdr session（可按 `--session` 切换）的多需求/缺陷自动驾驶编排：账本白名单隔离、`launch` 按 delivery-pipeline 模型配置启动 lane（`register --pane` 只认 launch 过的 pane）、每条 lane 登记所服务的 issue、一个 Epic 独占一个 workspace（`place` 按 `--epic` 复用或新建，`register` 拒绝跨 Epic 共用）、`place` 2×2 四格容量落位与 `<Issue号> <中文简写>[ <英文>]` 可视化命名门禁（workspace/tab/pane 宽度校验）、`register`/`awaiting_merge`/`done` 与 `sync-issue` 确定性同步 tracker 状态并回读校验（含未开始父链推升）、`--no-focus` 零抢焦点、同一状态只报一次的尾部巡检、每个 T3 线程一个本机哨兵进程定时巡检、状态变了才经 T3 `t3_thread_send` 唤醒并带上巡检结果、连续自动回复熔断、三档暂停分诊与已登记任务资源回收 | 不拥有未登记手工 pane 控制权、`dimon-mode` 原则正文、各上游规划/交付 Skill 流程或不可逆操作授权（合并/部署/强推） | SKILL.md + references/pause-triage.md + scripts/autopilot.js + scripts/closeout.js + scripts/issue-sync.js + scripts/launch.js + scripts/layout.js + scripts/watch.js + agents/openai.yaml | `herdr` CLI、Node.js、`mcporter`（magpie Linear MCP）、`gh` CLI、T3 `acp-mcp-call`、`delivery-pipeline-setup` 的 `model_config.py`（probe/resolve/start）；`dimon-mode` 原则叶子与路由目标 Skill | `node scripts/check-skills.js` + `node --test skills/herdr-autopilot/tests/autopilot.test.js` |
| skills/to-epic | Epic 规划与授权发布：调度影响拆分的查证、拷问与原型，以同一 Epic 承载结论；MMF 候选通过切分测试（切得开即多个 MMF，切不开即一个，不论大小）与单独上线测试，共用使能工作归首个用到它的 MMF；确定当前 Module/Interface、阻塞边（开工/上线）与开工波次，按获批范围滚动细化 | 不拥有 Spec、实施 tickets、产品实现、MR 或部署；不依赖特定执行方 | SKILL.md + agents/openai.yaml + references/verification.md | codebase-design；按需 investigate、research、grilling、prototype；按 Epic 或单个 MMF 路由的交付入口；目标项目 tracker | YAML/调用元数据检查 + 隔离链接安装；行为案例见 references/verification.md |
| skills/to-spec | 判定需求正好是一个 MMF 后整理成单份 Spec（多个 MMF 交回 to-epic，不足一个 MMF 点名所属 MMF）：条件式 Business Flow（状态图、T、R）、按 codebase-design 写 Module，Interface 用代码写并给关键签名加 `Ensures:`，跨 Module 的 R 列参与方，Dependencies 节写 MMF 阻塞边并连 tracker 原生阻塞关系，来自 Epic 的 Spec 创建即以 Epic 为原生父项，T/R 到 Module 与测试的覆盖核对，Business Flow 每个状态唯一 owner（ADR 0021）（本仓自有，改写自上游，出处见 sync-upstream-skills/references/adapted-sources.md） | 不拥有 Epic 切分、实施 tickets、形式验证生成或实现 | SKILL.md + scripts/check-spec.js（发布前确定性核对与读回父项核对）+ agents/openai.yaml + references/verification.md | codebase-design；architect；按需 create-formal-verification-skill；to-epic（多个 MMF 时请用户调用）；目标项目 tracker | `node scripts/check-skills.js` + 隔离链接安装；行为案例见 references/verification.md；`node --test skills/to-spec/tests/check-spec.test.js` |
| skills/architect | 写代码前定形状：追踪触及系统，画两种类型/签名/Module 边界，按状态唯一 owner、一事一法、调用方知道最少选定，输出每个状态一行的归属表（本仓自有，改写自上游，ADR 0021） | 不拥有 Spec 正文、实现、原型比较（归 principle-exhaust-the-design-space） | SKILL.md + agents/openai.yaml | principle-redesign-from-first-principles、principle-model-the-domain、principle-exhaust-the-design-space | `node scripts/check-skills.js` 与人工审查 |
| skills/to-tickets | 手动调用；本仓自有（取代上游 mattpocock to-tickets，ADR 0020）。把一个 MMF 的 Spec 切成 MR 分支内的 ticket：合同票先冻结 Interface 与共享写入目标，行为票按 T/R 唯一 Owns 切分，只连行为或合同两类依赖边，`scripts/check-tickets.js` 确定性核对锁定预览的改动项归属、场景覆盖、依赖图、波次、关键路径和票面 token 数字，用户裁决照此执行/重切/转例外模式后发布并读回；单票也走全流程；例外模式下逐票合入、隐藏手法与收尾片、里程碑放量；审查现有拆票 | 不拥有 MMF 切分（to-epic）、Spec 写作（to-spec）、token 预测与拆分线（ticket-sizing）、例外模式的逐票执行与合入授权（delivery-pipeline 独立票模式） | SKILL.md + scripts/check-tickets.js + references/ + agents/openai.yaml | to-spec 的 `scripts/check-spec.js`（解析函数）；spec-preview 的 `lib/change-items.cjs`（改动项归属核对）；ticket-sizing；请用户调用 to-epic、implement | `node --test skills/to-tickets/tests/check-tickets.test.js` + references/verification.md 的隔离前向案例 |
| skills/linear-archive-issues | 授权目标核对、Linear Issue 归档与持久结果回读 | 不拥有工作流验收、状态关闭或删除 | SKILL.md | Linear MCP、GraphQL API、Python 3；macOS 钥匙串（本机凭证） | SKILL.md「验证锚点」与内嵌命令语法检查 |
| skills/git-commit | 本地提交边界与范围核验 | 不拥有合并、推送 | SKILL.md | git CLI | `node scripts/check-skills.js`与人工审查 |
| skills/git-worktree | 任务工作树的建、列、回收：命名、起点（默认集成基准：main 或其上游）、不限工作树数量、只读产物软链复用、四条件安全回收（含 squash 合入识别；`new` 建的树及其本地分支的唯一回收 owner）；暂停与用户授权的上下文交接（wip 提交 + 正文恢复说明）、接手、主目录脏改动搬迁的顺序（ADR 0013） | 不拥有合入 main（归 git-rebase-main）、提交边界（归 git-commit）、收尾读回、其余临时树与远端分支（归 git-rebase-main 收尾合同）、推送或删除未合入的树 | SKILL.md + scripts/worktree.sh（new/ls/gc）+ agents/openai.yaml | git CLI、find、lsof；git-rebase-main 的 references/closeout.md（收尾读回） | `node --test test/git-worktree.test.js` |
| skills/git-rebase-main | 任务分支到本地 main 的 rebase、快进与收尾（只从任务分支合入，main 上的任务改动先经 git-worktree 搬走）；共享收尾合同负责合入后上传并核验预览附件、清理本地预览、关闭直接 Issue、回收远端源分支与非 worktree.sh 临时树，并读回 gc 回收结果 | 不拥有目标分支远程推送、worktree.sh 任务树与其本地分支的回收（归 git-worktree gc）或其他任务清理 | SKILL.md + references/closeout.md + scripts/closeout-preview.mjs | git CLI、目标 tracker、spec-preview 的缓存路径规则；git-commit、git-worktree（搬迁与 gc 回收）、resolving-merge-conflicts（第三方 skill） | `node scripts/check-skills.js`、`node --test skills/git-rebase-main/tests/closeout.test.mjs`、spec-preview 的 S8/S9 |
| skills/git-push-pr | 推送已验证分支并建/更新唯一 GitHub PR | 不拥有 PR 正文模板、审批、合并、issue 关闭 | SKILL.md | git CLI、gh CLI；git-rebase-main 的预览门；git-commit、resolving-merge-conflicts；mattpocock-skills:pr（正文模板，运行时入口：`~/.agents/skills/pr/SKILL.md`） | git-rebase-main 的 R10 合同测试 |
| skills/gh-merge-pr | 单个 GitHub PR 的 current-head SubAgent Review、合并、落地读回与收尾编排 | 不拥有 Review / 收尾规则、产品修复、批量 PR、远程推送分支 | SKILL.md | gh CLI、git CLI；git-rebase-main 的 references/closeout.md；code-review（固定主审）；complexity-optimizer、thermo-nuclear-code-quality-review（用户调用）、better-interface、vercel-react-best-practices、supabase-postgres-best-practices、blast-radius（按证据专项）；resolving-merge-conflicts | `node scripts/check-skills.js`、git-rebase-main 的 R10 合同测试与隔离 Git 演练 |
| skills/resolving-merge-conflicts | 真实 merge/rebase 冲突的解决流程（本仓自有，原文取自上游快照，上游已删除；出处见 sync-upstream-skills/references/adapted-sources.md） | 不拥有 rebase 发起、推送或收尾 | SKILL.md + agents/openai.yaml | git CLI | `node scripts/check-skills.js` |
| skills/{thermo-nuclear-code-quality-review,better-*,vercel-react-best-practices,supabase-postgres-best-practices,productionize-app-with-services,show-me,principle-*,benchmark-checklist,statechart} | 提供来源清单锁定的第三方套件 Skill 上游快照 | 不拥有上游行为演进或隐式本地 patch | 各自 SKILL.md | 上游 Git 仓库；sync-upstream-skills | 来源 hash + `node scripts/check-skills.js` |
| skills/code-review | Standards / Spec 双轴审查、P0–P3 严重度与 P0/P1 阻断线、P0/P1 可跑反例、每个 MMF 一轮的审查范围与 Standards 轴触发条件、Spec 缺口（措辞歧义不判实现）、锁定版改动项的 `ItemVerdict` 与未接受偏差的 P1/BLOCK 判定、OCR 专项（覆盖清单、规则组与 native 审查，comment 须核实后才成 finding；ADR 0023）（本仓自有，改写自上游，出处见 sync-upstream-skills/references/adapted-sources.md） | 不拥有审查模型选择、Pipeline 证据 transport、P2 issue 登记、实现或发布 | SKILL.md + scripts/ocr-native.js + scripts/item-verdicts.js | caller 的固定证据与规范/spec；spec-preview 的 `changes` 与 `lib/change-items.cjs`；可选 `ocr` CLI（alibaba/open-code-review）、delivery-pipeline `model-roles.json` 的 Review 主选模型、pi `models.json` | 与上游 diff 只含本仓增补 + `node --test skills/code-review/tests/ocr-native.test.js` + `skills/spec-preview/tests/scenarios.test.mjs` 的 S6 + `node scripts/check-skills.js` |
| skills/bdd | 场景独立预期、公开入口选择与缺陷复现；把结果接到可证明的检查 | 不拥有项目测试规范、测试审查、实现或提交 | SKILL.md + agents/openai.yaml | test-review 启发式；目标项目测试规范 | `node scripts/check-skills.js`与人工审查 |
| skills/implement | 按 Spec 或 Brief 实施：验收与失败方式、按切片调用 bdd、入口清单、相关 E2E 与形式验证、审查前对账（第 4 步按 `Preview:` 逐项记录结论与证据）、仅在整个 MMF 完成时调用 code-review（fixed point 为 MMF 开工前 SHA，spec 源为 MMF Spec 与验收清单）与 P2 待登记项或获授权的登记记录、P0/P1 以反例变绿加完整测试关闭、经 git-commit 提交、上下文吃紧时交回恢复信息或按用户授权委派、提交 WIP（本仓自有，改写自上游，出处同上） | 不拥有审查规则与严重度、测试细则、推送、PR 或合并 | SKILL.md + agents/openai.yaml | bdd、code-review、git-commit；按需 blast-radius、git-worktree（wip 交接）、principle-guard-the-context-window；目标项目 tracker 与 formal-verify skill | `node scripts/check-skills.js`与人工审查 |
| skills/test-review | 按目标项目测试规范审查测试正确性、必要性与覆盖证据；Standards / Spec 两轴独立 | 不拥有测试清理、规范修订、全仓审计或合并 | SKILL.md | caller 的固定证据、项目测试规范与 spec；宿主子 agent（可用时） | `node scripts/check-skills.js` + 隔离案例双轴前向测试 |
| skills/test-discipline | 测试与压测文件判定、写前自检核心、项目测试规范定位、Claude/Codex PreToolUse 与 SubagentStart 提醒、共享字面量写入目标解析与 Claude Bash 提醒、Codex PostToolUse/Bash 调用后提醒、Codex 多文件补丁解析与 transcript 只读去重、Pi 当前进程（含独立子进程）的 edit/write、bash 与 codemode 字面量写入成功后提醒，同一运行时按测试文件去重；显式建档流程与基线测试规范模板；Claude/Codex hook 与 Pi 扩展 symlink 的注册、--check 与 --uninstall（取舍与回退见 repo://docs/adr/0003-skill-owned-agent-hooks.md） | 不拥有项目阶段、生成后项目规范的后续维护或用户全局配置的其余内容；不覆盖 Pi 带 parentToolCallId 的嵌套结果 | SKILL.md + hooks/entry.cjs（claude / codex） + hooks/codex.cjs + hooks/pi.js + scripts/install-hooks.cjs + references/ | Node.js；Pi 扩展 API；test-review 测试启发式；project-template 改写来源见 adapted-sources.md | `node --test skills/test-discipline/tests/*.test.cjs`；临时 git 仓手动演练补索引与生成基线 |
| skills/how | 代码机制讲解与子系统走读（本仓自有，改写自上游，出处见 sync-upstream-skills/references/adapted-sources.md） | 不拥有动机溯源 | SKILL.md + references/ | 无 | `node scripts/check-skills.js`与人工审查 |
| skills/no-comments | 显式调用的注释清理、必要例外与范围内根因修复（本仓自有，改写自 pstack，出处同上） | 不拥有范围外重构、提交或发布 | SKILL.md + references/comment-sicko.md + agents/openai.yaml | how、why；宿主子 agent（可用时） | `node scripts/check-skills.js` + 隔离案例前向验证 |
| skills/in-your-own-words | 显式调用时复述用户目标与问题（本仓自有，改写自 pstack，出处同上） | 不拥有实现或文件修改 | SKILL.md + agents/openai.yaml | 无 | `node scripts/check-skills.js` + 隔离案例前向验证 |
| skills/reframe | 显式调用时为用户要构建的内容命名专业术语、借用相邻领域词汇、核实参考链接并重写描述（本仓自有，改写自 pstack，出处同上） | 不拥有任务执行或文件修改 | SKILL.md + agents/openai.yaml | 无 | `node scripts/check-skills.js` |
| skills/sharpen | 显式调用时保留既有专业术语把用户请求改写得更深而不更大，要求实验可决定的选择先做原型，只交付四问与改写后的请求（本仓自有，改写自 pstack，出处同上） | 不拥有任务执行或文件修改 | SKILL.md + agents/openai.yaml | 无 | `node scripts/check-skills.js` |
| skills/correct | 显式调用时从仓库历史找 agent 反复犯的错误类别，逐类在最高可行层级消除，并证明新检查在旧错误上失败（本仓自有，改写自 pstack，出处同上） | 不拥有会话级教训（归 retro）、提交或推送 | SKILL.md + agents/openai.yaml | principle-encode-lessons-in-structure | `node scripts/check-skills.js` |
| skills/ticket-sizing | 逐票 token 拆分信号、粒度判定、MMF 合计与 100k 拆分线的超线拆票；本仓自有 Skill | 不拥有切片流程、用户裁决或发布（to-tickets） | SKILL.md + agents/openai.yaml | to-tickets；GLOSSARY.md 的 MMF 词条 | `node scripts/check-skills.js` + `node --test test/*.test.js` |
| skills/why | 代码与决策的动机溯源（本仓自有，改写自上游，出处同上） | 不拥有机制讲解 | SKILL.md + references/ | git CLI、gh CLI；环境可用的证据类 MCP | `node scripts/check-skills.js`与人工审查 |
| skills/create-verification-skill | 生成项目本地 verify skill 与 feature map（本仓自有，改写自上游，出处同上） | 不拥有生成物的运行节奏与产品修复 | SKILL.md + references/ | 无 | `node scripts/check-skills.js`与人工审查 |
| skills/maintain-verification-skill | 项目本地 verify skill 与 feature map 的漂移审计（本仓自有，改写自上游，出处同上） | 不拥有产品代码修复 | SKILL.md | 无 | `node scripts/check-skills.js`与人工审查 |
| skills/create-formal-verification-skill | 选一条承诺做形式验证，生成项目本地 formal-verify skill（本仓自有，改写自上游，出处同上） | 不拥有验证工具安装、产品修复或生成物的运行节奏 | SKILL.md | 目标项目可安装的验证工具（TLA+、Kani 等） | `node scripts/check-skills.js`与人工审查 |
| skills/maintain-formal-verification-skill | 代码变更后让 formal-verify skill 重新描述现行代码，并区分漂移与 bug（本仓自有，改写自上游，出处同上） | 不拥有产品代码修复 | SKILL.md | 目标项目的 formal-verify skill | `node scripts/check-skills.js`与人工审查 |
| skills/investigate | 只读调研的路由与收口：机制走 how、动机叠加 why、决策给推荐与 tradeoffs（本仓自有，改写自上游，出处同上） | 不拥有机制讲解、动机溯源或代码变更 | SKILL.md | how、why | `node scripts/check-skills.js`与人工审查 |
| skills/blast-radius | 改动影响面分析与安全事实的代码取证（本仓自有，改写自上游，出处同上） | 不拥有寻路决策与产品修复 | SKILL.md | how、why；wayfinder（影响面起雾时） | `node scripts/check-skills.js`与人工审查 |
| skills/sync-upstream-skills | 上游快照的来源、锁定状态、检查与显式更新；改写自有 Skill 的出处清单（adapted-sources.md） | 不拥有快照内 Review 规则、运行时链接或独立项目更新 | SKILL.md + scripts/sync-upstream-skills.js | git CLI、Node.js、references/sources.json | node:test + `--check` |
| skills/postmortem | 可复用失败教训的判定与落账 | 不拥有工作流状态、远程交付、环境改动建议（归 retro） | SKILL.md + scripts/postmortem-contract.js | Node.js | 契约脚本经单元测试（test 目录当前未迁入，待补） |
| skills/retro | 会话与失败链路复盘：三视角找教训、按目标路由、筛成 Accepted/Rejected/Backlog，批准后应用环境改动 | 不拥有教训记录与召回（归 postmortem）、未经授权的 tracker 登记 | SKILL.md + references/（lenses、synthesis、environment）+ agents/openai.yaml | postmortem（recall）；principle-encode-lessons-in-structure；按需 writing-for-agents；调用方的模型配置 | 人工审查：与 postmortem 职责不重叠；上游两版信息逐项可对照；R3 出口能调用 |
| skills/pi-loop | pi 内的循环调度扩展：`/loop` 命令（自定节奏、固定间隔、cron）、`loop_next` / `loop_status` 工具、循环状态与会话条目持久化、暂停与恢复规则、状态行；安装器对 `~/.pi/agent/extensions/pi-loop` 的注册、`--check` 与 `--uninstall`。自建而非采用第三方包，取舍与状态模型见 repo://docs/pi-loop/technical-design.md | 不拥有模型对循环内容的判断、跨会话或后台守护调度、停机期间错过的轮次；不覆盖 print/rpc/json 模式与子 agent 会话的调度 | SKILL.md + lib/index.js（pi 扩展入口） + scripts/install.js + tests/ | Node.js；pi 扩展 API 与宿主提供的 typebox | `node --test skills/pi-loop/tests/*.test.js`；pi 1.4.0 TUI 端到端记录见 repo://docs/pi-loop/technical-design.md 第 7 节 |
| skills/delivery-cycle | 周期规划、维护与正式交付判断的唯一 owner：原生未来周期准备、目标与 Issue 排期；脚本维护本周集合、持久剔除／恢复及按正式交付结转 | 不拥有 Linear 配置和工作流事实、Spec 验收或 main 合入事实；不拥有开发派发、M2 hooks 与 M3 周报 | SKILL.md；references/plan-next-cycle.md（原生未来规划）；scripts/run.js（本周 CLI）；scripts/delivery-cycle.js（assessFormalDelivery、maintainCurrentWeek） | 原生规划：官方 Linear MCP，缺配置／命名能力时使用已登录界面；本周脚本：Node.js、linear-mcp.js（默认，经 mcporter 复用 OAuth）、可选 linear-graphql.js 与 evidence.js Adapter | references/verification.md（规划与入口分流）；`node --test skills/delivery-cycle/tests/*.test.js`（本周脚本）；提前排期不替代真实运行验收 |
| skills/formal-verify-delivery-cycle | delivery-cycle 维护入口时序／重试性质的有界穷举检查：R8 不写回旧周、R9 先读后写不盲重放、verified 必有回读、partial 不冒充 synchronized、R11 重跑零写入；记录覆盖函数与 sync commit | 不拥有 delivery-cycle 规则、产品修复或真实 Linear 验收（DD-545）；不是无界证明 | SKILL.md + scripts/verify.js + scripts/world.js + scripts/mutants.js + references/coverage.md；项目入口 .agents/skills/formal-verify-delivery-cycle 为指向本目录的 symlink | Node.js；skills/delivery-cycle 的 maintainCurrentWeek 与 tests/fake-adapters.js | `node skills/formal-verify-delivery-cycle/scripts/verify.js`；`node skills/formal-verify-delivery-cycle/scripts/mutants.js` |
| skills/spec-preview | Spec 预览与锁定、改动项提取、对比页、变更预览、按附件重建对比页 | 不拥有 smyw 渲染或反馈、Spec 发布、拆票、合入或附件核验与缓存清理 | [SKILL.md](../../skills/spec-preview/SKILL.md) + spec-preview.mjs（含 `changes`、`restore`）+ lib/change-items.cjs（供 to-tickets 复用） | Node.js；smyw 链接依赖 | `node skills/spec-preview/tests/check-skeleton.mjs`、`skills/spec-preview/tests/scenarios.test.mjs` 的 S7、S9 |
| smyw（独立单-Skill 项目） | 渲染预览与应用反馈 | 不拥有本仓 Spec 预览的锁定、归档与工作流路由 | scripts/build.mjs + scripts/apply-feedback.mjs | [上游 clone](https://github.com/nishuzumi/show-me-you-want-skill) 经安装脚本链接到 agent 目录 | `node --test test/install-development-workflow.test.js` |
| scripts/check-skills.js | Skill 校验：name 等于目录名、有 description、相对链接可解析；上游快照的已知断链读来源清单 `knownBrokenLinks`，只报告 | 不拥有 Skill 内容或来源清单 | CLI，退出码 0/1 | node | `node --test test/check-skills.test.js` |
| scripts/link-skills.sh | 把 skills/ 链入 agent 目录并拒绝覆盖普通目录；拒绝在任务工作树里运行 | 不拥有 skill 内容 | CLI | bash | `bash -n` + 隔离 HOME 检查；工作树守卫由 `test/git-worktree.test.js` 覆盖 |
| scripts/install-development-workflow.sh | 链接本仓 Skill，并为独立第三方项目获取 clone 与建立链接依赖 | 不安装整套 Review Skill 套件、Agent CLI、Herdr 或 Second Opinion | CLI | bash、git、python3、独立第三方 Skill 仓库 | `bash -n` + 隔离 HOME 的 offline install/check |

依赖方向：

    agent 运行时 -> symlink -> skills/<name>/SKILL.md -> 契约脚本 / 上游快照
    agent 运行时 -> symlink -> 独立单-Skill 项目 clone

## 链路

端到端链路：

    编辑 skills/ -> git commit -> 其他会话经 symlink 即时可见
    新增 skill -> scripts/link-skills.sh -> agent 目录出现新 symlink
    完整开发链路 -> scripts/install-development-workflow.sh -> 本仓快照 + 独立项目 clone + agent 目录 symlink

第三方 skill 链路：

    套件仓库选取路径 -> sync-upstream-skills -> skills/<name> 上游快照 -> symlink -> agent 目录
    独立单-Skill 项目 clone -> symlink -> agent 目录

## 不变量

任何实现不能破坏的根约束：

- 根目录（`~/.agents/skills`、`~/.claude/skills`）里指向本仓的条目必须是 symlink，不能是副本。
- 第三方套件只复制来源清单点名的单个 Skill，不安装整套套件。
- 每个上游快照必须匹配来源清单的 commit 与内容 hash；仓内漂移阻断自动更新。
- 独立单-Skill 项目保留上游 clone，经链接依赖接入。
- 每个 skill 只有一个 `SKILL.md` 作为公开合同；不建第二份说明文件。

## 更新触发

以下变化必须更新本文件：

- 新增或删除 skill、脚本。
- skill 公开入口、依赖方向或所有权变化。
- 链接机制、目标目录或外部系统变化。

难回退或存在真实取舍的决定同时写入 repo://docs/adr/。

## 验证

- skill 内容：由调用它的 agent 会话验证，无独立 CI。
- 链接：`scripts/link-skills.sh` 运行后 `ls -la ~/.agents/skills` 可见 symlink。
- 开发链路安装：使用隔离 HOME 与现有依赖 checkout 运行 `scripts/install-development-workflow.sh --offline`，再运行 `--check`。
- 上游快照：运行 `node skills/sync-upstream-skills/scripts/sync-upstream-skills.js --check`。
- 契约脚本：postmortem-contract.js 的单元测试当前未迁入本仓，状态为 Unknown；补测试后更新本行。

## PROTOCOL

根合同（本文件「当前事实」「链路」「不变量」）变化时同步：

- repo://GLOSSARY.md（统一语言）。
- 根 repo://AGENTS.md（指针与触发）。
- 命中 skill 的 SKILL.md（L2）。
- 架构取舍写 repo://docs/adr/ 新 ADR，不改写已 accepted 的结论。
