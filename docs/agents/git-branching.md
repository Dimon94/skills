# 分支与工作树纪律

主词：**主目录只做集成；一个写任务一棵树一个写者**。

建树、列在做清单、回收都用 repo://skills/git-worktree/scripts/worktree.sh（`new`、`ls`、`gc`），操作顺序见 repo://skills/git-worktree/SKILL.md。

## 分支纪律

1. **主目录永远只 checkout main，只做集成。** 不在主目录切分支，也不在主目录写文件。主目录出现未提交改动即违规：逐路径盘点，属于某个任务的用 `git diff` 补丁搬进该任务的新树，不 stash（stash 跨工作树共享）。
2. **每个写任务一棵树。** bug、需求、文档都一样，一行改动也不例外；herdr 分派的票同样一票一树。只读任务（调研、审查、看 diff）不建树。
3. **分支随树创建，一任务一分支。** 用 `worktree.sh new <type>/<scope>` 从本地 main 最新 commit 建树，任务分支只存在于该 worktree 里。命名 `<type>/<scope>`：`fix/`、`feat/`、`research/`、`chore/`、`docs/`。禁止从任务分支再开任务分支。
4. **main 只接收已验证提交，一次合一棵树。** 验证证据先于合并；多棵树就绪时逐棵经 `git-rebase-main` 合入，后一棵在前一棵合完后再 rebase。研究分支的结论先落 `docs/research/`，再决定合并或废弃。
5. **收口即删。** 票合并后在主目录跑 `worktree.sh gc --apply` 回收；票废弃时经用户授权移除 worktree 并删除本地和远端分支。
6. **暂停即 wip 提交。** 用户说“暂停”即授权在任务分支上提交一个 `wip:`，恢复说明写进提交正文；不 push、不碰 main。接手时读 `worktree.sh ls` 和 `git log main..<branch>` 的正文。
7. **一票一写者。** 同一分支同一时刻只有一个写者。并行 agent 只读；需要写入的用独立 worktree。任何 agent 不得删除仍有写者的分支或 worktree。

## 推送与合并授权

- force-push 只在用户明确要求改写该分支已发布历史时执行。普通 push 因 non-fast-forward 被拒时，报告原因并等待指示，不强推。
- 合并 PR 或开启 auto-merge 只在用户明确要求合并该 PR 时执行。CI 通过、review 批准和“继续”指令都不构成合并授权。

## 工作树流程

带票的任务按以下顺序执行；后一步不能替代前一步。无票的小改从第 2 步开始。

1. **开票。** 把现象或需求收敛为一个可独立验收的票。根因 Unknown 时保持方案中立：验收标准只写可观察结果和设计不变量，实现猜想只进调查记录。票落本仓 GitHub issue（`gh issue create`）并保留 issue 编号。完成标准：票含用户现象、可检查验收标准和真实依赖关系。
2. **建树。** 用 `worktree.sh new <type>/<scope>` 为该票创建独立 worktree，任务分支随树创建、只存在于树内；主目录保持 main 不动。达到 `WT_MAX` 时先收尾或暂停一棵在做的树，不调高上限。执行"一票一树一写者"。主 agent 写本树时，后台研究只读；需要写文件的研究使用独立 worktree，或等主 agent 交出写权。完成标准：只过滤本票的 `git worktree list --porcelain` 可确认唯一 branch/path/HEAD，主目录仍是 main 且无本票差异。
3. **诊断与实现。** 缺陷按 repo://docs/agents/debugging.md、需求按 repo://docs/agents/development-workflow.md 的证据闭环执行。新增测试前先跑最近现有测试。完成标准：同一最小检查先红后绿，focused tests 和 build 通过，一次性 harness 已清理。
4. **留存。** 把已通过检查的单一语义边界保存为本地候选提交。无关 dirty path 不被吸收。工具增量（formatter churn、lockfile 更新、生成产物）逐项解释归属，否则丢弃；合并后与意图无法区分。完成标准：候选提交狭且可审计；未经下一步验证不得进入 main。
5. **真实环境验证。** 按下方 Worktree 环境合同执行，走真实公开入口，同时断言 transport 和业务字段。行为变更对照未改动的主目录基线：行为差异新旧路径各跑一次，视觉差异同一视图各截一次；"应该等价"是声明，基线对照才是证据。完成标准：业务状态、输出身份和外部副作用计数同时通过。
6. **集成与清理。** 先在本票 worktree 执行 `git rebase main`，冲突在本树解决并重跑 focused tests；再回 main，确认无并行任务未提交差异后合入已验证提交。在 main 重跑最小 smoke，把 main commit、验证证据和剩余风险回写票。随后停止本树服务，确认 worktree clean 且提交已进入 main，再移除 worktree 并删除分支。移除前，本树产生的交付物（截图、构建、导出）先写到持久位置或附到票上，并显式说明位置；它们随树删除。完成标准：rebase 后验证仍绿，main 只包含完整已验证提交，无在途代码，票可由证据关闭。单票任务不执行全局 `git worktree prune`。

## Worktree 环境合同

Worktree 只检出 git 跟踪的源码，这部分开销小。真正的成本在依赖安装和环境变量重配。处理原则：**只读产物引用 main，可写状态留在本树**。

### 引用 main 的只读产物

`worktree.sh new` 建树后自动软链 main 里已生成的 `node_modules`、`.env`、`.venv`（三层目录内，`WT_SHARE` 可改），不复制、不重装。`gc` 判断干净时不把这些软链算作改动，删树前先删软链。

- `.env` 只有 main 一份。本树不复制、不改写。本票需要覆盖个别变量时，在启动命令前显式 `VAR=value` 传参，不落地成第二份 env 文件。
- 依赖目录软链 main。例外：本票改动了 lockfile 或依赖版本，必须在本树独立安装，并断掉软链——两棵树各跑各的版本。
- 工具链不吃软链时（Metro/打包器解析异常），退回复制并在票里记录原因。

### 本树独占的可写状态

- 构建产物、日志、数据根、PID 文件属于本树，不软链 main。数据根路径必须由启动方重写为本树路径，否则运行数据静默写回 main。
- 建树后，以及 build、真实请求、提交前，执行存活门：`.git` 存在，`git status` 可用，本票 branch/path/HEAD 仍在 `git worktree list --porcelain`。任一断言失败立即停止，不在 orphan 目录继续操作。
- 进程验身：请求前确认端口、PID、进程 cwd、branch/HEAD 和构建产物时间全部指向本树（命令见 repo://docs/agents/debugging.md 第 3 节）。
- 完成标准：可写状态全部留在本树，存活门全部通过，主树在 worktree build/test 前后 `git status --short` 不变。

### 及时清理

Worktree 是短期隔离，不是长期资产。磁盘和内存的上限靠三件事：

1. **上限。** `WT_MAX`（默认 4）限制同时存在的树；满了 `new` 退出 3 并打印在做清单。
2. **自动回收。** `new` 先跑 `gc --apply`：只删同时满足无改动、有过提交、已并入 main、无进程 cwd 在树内的树和分支，从不 `--force`；其余写明 `dirty`、`empty`、`unmerged`、`in-use:N` 保留。
3. **人工收口。** 票废弃时经用户授权移除，不留“以后可能有用”的树。`gc` 报告的 `prunable` 行是目录已删的旧记录，清理要单独决定。

完成标准：`git worktree list` 只剩主树和活跃票的树；`git branch` 只剩 main 和活跃票分支。单票任务不执行全局 `git worktree prune`。

## 检查

- 看到主目录不在 main、主目录有未提交改动，或看到没有 worktree 承载的任务分支 = 违反纪律，停下来盘点。
- 完成标准：主目录 checkout 永远是 main；`git worktree list` 只剩主目录和活跃票的树；`git branch` 的任务分支都能说出绑定的票和所在的树。
