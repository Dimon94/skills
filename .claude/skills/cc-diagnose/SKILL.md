---
name: cc-diagnose
version: 1.1.0
description: >-
  TOC diagnosis for hard bugs and performance regressions: build a tight red
  loop, minimise the repro, rank kill-probe hypotheses, instrument one variable,
  fix with an Injection, and prove the regression is gone.
skill_class: user-entry
route_family: bug
triggers:
  - diagnose this
  - debug this
  - 诊断这个问题
  - 调试这个 bug
  - 这里坏了
  - 有东西失败了
  - performance regression
  - TOC root cause
  - CRT/FRT bug analysis
  - 用 CRT 分析 bug
reads:
  - references/toc-thinking-processes.md
  - references/git-commit-guidelines.md
  - ../do-not-repeat-yourself/SKILL.md
  - ../postmortem/SKILL.md
  - ../cc-research/SKILL.md
writes: []
---

# CC-Diagnose

这是给困难 bug 和性能回退用的诊断纪律。核心是 **tight red loop**：一个已经跑过、能命中用户精确症状、可无人值守重复运行的 pass/fail 命令。没有它，诊断进入 blocked 或请求证据，不进入假设。

开始前先做 grounding：

- 读 `CONTEXT.md`（如果存在）或项目领域词汇表，建立相关模块心智模型。
- 触碰区域有 ADR、runbook 或 task evidence 时读取。
- 症状像历史复发、failed verification 或 workflow escape 时，用 `../postmortem/SKILL.md` 做 `recall`；只有用户明确要求或 closeout 需要时才记录新 incident。
- 第三方库、API、平台行为或旧研究 freshness 阻塞根因判断时，才用 `../cc-research/SKILL.md`；研究只能补 Evidence Gap，不能替代复现。

进入 Phase 3 前加载 `references/toc-thinking-processes.md`。从 Phase 3 到 Phase 6，用 TOC 约束根因记录：UDE 只能是观察；未知根因先写 Abductive ECE 和 kill probe；存活假设再收敛成 CRT；修复必须是 Injection；收尾必须有 FRT/NBR 检查。

## Parallel Orchestration Boundary

当 `cc-dev` 把本 skill 作为 `EF###` diagnosis environment 派发时：

- 只诊断触发该 environment 的失败：child failure、cherry-pick conflict、phase gate failure 或 `cc-check` fail。
- 在 Codex App 中创建 child thread 时，`projectId` 不能使用任意 worktree path；必须使用已保存项目的 project worktree path 创建子线程，然后在子线程内切到具体起始分支和目标 worktree。不要先拿临时/任务 worktree path 创建线程再等失败后纠正。
- 如果主控要求“用 Codex App 创建子线程，不用 subagent”，必须创建真实 Codex child thread；不要退回 subagent 或本线程假装并行。
- 先建立反馈环并复现原始失败；没有反馈环就返回 blocked。
- 修复必须产出独立 commit，除非诊断结论是不需要改文件。
- commit 只包含该 failure 的最小修复、回归测试、必要 task evidence 和 debug cleanup。
- commit 必须遵守 `references/git-commit-guidelines.md` 和 `../do-not-repeat-yourself/SKILL.md`；fix 类提交要写清根因、验证、风险，不能只写症状摘要。
- 如果发现真实问题超出当前 change scope，返回 route `cc-plan` 或独立 `FIX`，不要偷偷扩大当前需求。
- 最终报告必须包含 environment、commit、复现 loop、回归命令、dirty state、debug probe 清理和 route recommendation。

## Phase 1 - 建立反馈环

目标是得到 tight、red-capable、Agent 可运行的 pass/fail 信号。二分、假设检验、打点都消费这个信号；没有这个命令，Phase 1 未完成。

### 构造反馈环的优先顺序

1. **失败测试**：在能触达 bug 的最合适边界写单元、集成或 e2e 测试。
2. **Curl / HTTP 脚本**：打运行中的开发服务。
3. **CLI 调用**：用 fixture 输入运行命令，把 stdout 和已知正确快照 diff。
4. **Headless browser 脚本**：用 Playwright / Puppeteer 驱动 UI，并断言 DOM、console 或 network。
5. **回放捕获 trace**：保存真实 network request、payload 或 event log，在隔离代码路径里回放。
6. **一次性 harness**：只启动系统最小子集，用一个函数调用打到 bug 路径。
7. **Property / fuzz loop**：如果问题是“偶尔输出错误”，跑 1000 个随机输入找失败模式。
8. **二分 harness**：如果 bug 出现在两个已知状态之间，自动化“切到状态 X、启动、检查”，让 `git bisect run` 可以工作。
9. **差分 loop**：同一输入跑旧版本和新版本，或两套配置，然后 diff 输出。
10. **HITL bash 脚本**：最后手段。如果必须人类点击，用 `scripts/hitl-loop.template.sh` 驱动人类操作，至少让 loop 仍然结构化；捕获输出再喂回 Agent。

### 迭代反馈环本身

把反馈环当产品。一旦有了一个 loop，继续追问：

- 能不能更快？缓存 setup、跳过无关初始化、缩小测试范围。
- 信号能不能更尖锐？断言具体症状，而不是只断言“没崩”。
- 能不能更确定？固定时间、seed RNG、隔离文件系统、冻结网络。

30 秒且 flaky 的 loop 不能支撑调试；继续压缩到足够快且确定。

### 非确定性 bug

目标不是完美复现，而是**提高复现率**。循环触发 100 次、并行、加压、缩小时间窗口、注入 sleep。50% 复现率的 flaky bug 可调试；1% 不行。继续提高复现率，直到它可调试。

### 真正无法建立反馈环时

停下来，明确说明。列出你试过什么。向用户索要：

1. 能复现的环境访问权；
2. 捕获物，如 HAR、日志、core dump、带时间戳录屏；
3. 添加临时生产打点的许可。

该阶段输出 blocked record：已尝试的 loop、缺失的证据、向用户索要的最小 artifact。

### 完成标准：tight loop goes red

Phase 1 完成时，必须能写出一个已经亲自运行过的命令（测试、脚本、curl、CLI 或 HITL 脚本），并贴出 invocation 与关键输出。它必须满足：

- [ ] **Red-capable**：打到真实 bug 路径，断言用户的精确症状；不是只证明“没崩”。
- [ ] **Deterministic**：同样输入给同样结论；非确定性 bug 已固定高复现率。
- [ ] **Fast**：以秒计，而不是分钟级调试循环。
- [ ] **Agent-runnable**：可无人值守运行；必须人工点击时只能通过 `scripts/hitl-loop.template.sh` 结构化。

## Phase 2 - 复现 + 最小化

运行反馈环，亲眼看见 bug 出现。

确认：

- [ ] loop 产生的是**用户描述的失败模式**，不是附近另一个失败。复现错 bug，就会修错 bug。
- [ ] 失败能多次复现；如果是非确定性 bug，复现率已经高到可以调试。
- [ ] 已捕获准确症状：错误信息、错误输出、慢耗时。后续阶段必须能证明修复确实消除了这个症状。

复现确认三项全满足后，进入最小化。

### 最小化

一旦 loop 变红，把复现场景缩到仍然变红的最小形态。一次只删一个变量：输入、caller、配置、数据、步骤、环境开关。每删一次都重跑 loop，只保留对失败承重的元素。

完成标准：

- [ ] 剩余每个元素都是 load-bearing；移除任一元素都会让 loop 变绿或改变失败模式。
- [ ] 最小复现仍然命中用户的原始症状。
- [ ] 最小复现可以在 Phase 5 变成正确测试边界上的回归测试，或已经记录为什么没有正确边界。

三项完成标准全满足后，进入 Phase 3。

## Phase 3 - 假设

测试任何假设前，先生成 **3-5 个排序后的假设**。只生成一个假设会把你锚死在第一个看起来合理的解释上。

每个未知根因假设以 Abductive ECE 起步：

```text
observed UDE <- suspected cause -> independent predicted effect
```

每个假设必须有一个优先证伪的 kill probe：

```text
如果 X 是原因，那么改变 Y 会让 bug 消失 / 观察 Z 会杀死这个假设。
```

如果 kill probe 说不清预测，那它不是假设，只是感觉。丢掉或 sharpen。

对关键 ECE/CRT 边使用 CLR 检查；说不清实体、因果或预测的边不能进入 Phase 4。只有 survive kill probe 的假设才收敛成 CRT：

```text
root fact -> deeper cause -> direct cause -> UDE
```

如果修复方向被两个真实需要拉扯，写 Conflict Cloud，找出要打破的隐藏假设。

**测试前把排序后的假设列表展示给用户。** 用户常常有领域信息能立刻重排，例如“我们刚部署了 #3”。这是便宜但高价值的 checkpoint。不要因此阻塞；如果用户不在，就按你的排序继续。

## Phase 4 - 打点

每个 probe 都必须对应 Phase 3 的一个具体预测。先跑 kill probe；kill probe 未杀死假设后，再收集独立确认信号。**一次只改一个变量。**

工具优先级：

1. **Debugger / REPL 检查**：环境支持时优先用。一个断点胜过十条日志。
2. **定向日志**：只打在能区分假设的边界上。
3. 不要“全量 log 然后 grep”。

**每条 debug log 都加唯一前缀**，例如 `[DEBUG-a4f2]`。收尾时一次 grep 就能清掉。无 tag 的日志会活下来；有 tag 的日志必须死。

**性能分支。** 性能回退通常不该靠日志。先建立 baseline measurement：timing harness、`performance.now()`、profiler、query plan，然后二分。先测量，后修复。

## Phase 5 - 修复 + 回归测试

先写回归测试，再修复；但前提是存在**正确测试边界**。

修复需要新增 helper、adapter、validator、parser、script、schema 或其它 reusable mechanism 时，先运行 `../do-not-repeat-yourself/SKILL.md`。已有 wheel 能覆盖就复用；不能复用才记录原因并写最小新机制。

把修复写成一个 Injection：它具体打断哪条 CRT 因果边，或废掉哪个 Conflict Cloud
隐藏假设。非平凡修复先写 FRT/NBR：期望哪个 UDE 变成 DE，最可能新增哪个负分支，
用哪个最便宜的检查拦住。

正确边界指：测试覆盖 bug 在真实调用点发生时的实际模式。如果只有太浅的边界，例如 bug 需要多个 caller 才出现却只测单个 caller，或 unit test 复现不了触发链，那么这个回归测试会制造虚假信心。

**如果没有正确边界，这本身就是发现。** 记录下来。代码架构正在阻止这个 bug 被锁住。把它留到最后的架构 follow-up。

如果存在正确边界：

1. 把最小复现变成该边界上的失败测试。
2. 看它失败。
3. 应用修复。
4. 看它通过。
5. 重新运行 Phase 1 的原始、未最小化场景。

## Phase 6 - 清理 + 事后复盘

宣布完成前必须检查：

- [ ] 原始复现不再复现：重新运行 Phase 1 loop。
- [ ] 回归测试通过；如果没有正确边界，已经记录原因。
- [ ] 所有 `[DEBUG-...]` 打点已删除：grep 前缀确认。
- [ ] 一次性 prototype 已删除，或移动到明确标记的 debug 位置。
- [ ] 最终 TOC 记录写进 commit / PR message：UDE、确认的 CRT、Injection、FRT/NBR。
- [ ] 若这是可复用失败教训，在 active change 中写入 `task.md#Failure Ledger`；独立 postmortem 只在用户明确要求或 closeout 需要时按 `../postmortem/SKILL.md` 执行。

然后问：什么本来可以防止这个 bug？如果答案涉及架构变化，例如没有好测试边界、caller 缠在一起、隐藏耦合，就把具体信息交给架构改进流程。这个建议必须在修复之后提出，不要在修复前空谈；修完后你掌握的信息更多。
