# 合入收尾合同

`git-rebase-main` 与 `gh-merge-pr` 绑定任务时读取第 1 节，合入及最小验证成功后执行第 2–5 节。
本文件拥有直接 Issue、源分支和本次临时工作树的收尾规则；调用方提供落地证据。

## 1. 固定收尾范围

用户要求执行完整合入流程时，收尾属于同一次任务授权；沿用会话中已有授权，不逐步重复
索取。仅 Review 或仅同步分支的请求保持原范围。项目另有确认口令或权限要求时遵从其要求，
缺少授权的对象记 `BLOCKED` 并点名所需授权。

建立对象清单，删除后仍能从主工作区访问它：

- 直接 Issue 的 tracker、仓库或项目、ID、验收标准。来自用户绑定的任务或 PR 的明确关闭
  关系（`Closes` / `Fixes` / `Resolves` 及其变体），核对正文与平台关联，保留跨仓库身份。
  Parent、sibling、blocker 和仅被提及的 Issue 保持只读。关系不明记 `Unknown`，阻断收尾。
- 本地源分支与预期 HEAD、源远端及其仓库 URL 与远端预期 HEAD；目标分支、落地 HEAD 和包含关系。
  两端 SHA 分别记录；远端预期 HEAD 必须属于本次已落地的提交集。经历本地 rebase 时，
  在 rebase 前固定原源 HEAD，并证明远端预期 HEAD 是其祖先。PR 还需记录 Review Packet
  head、`MERGED` 状态与 merge SHA。Fork 分支只在用户拥有或明确获授权时删除。
- 主工作区、任务工作树、本次创建的 Review 工作树，以及各自 branch/path/HEAD。
  已有 `main` 任务没有源分支可删；确实没有 Issue、远端源分支或临时树时逐项记 `not applicable`
  并给出查询依据。用户明确要求保留的对象记录保留指令。

完成标准：每个对象都已确定归属、授权与预期终态；没有猜测的 ID、remote 或路径。
以下步骤按顺序执行，任一步阻断就停止后续写入，保留现场与已完成结果。

## 2. 关闭直接 Issue

逐项对照验收标准与落地后的验证证据。要求部署或外部验收的 Issue，只有本地合入证据
仍不足以关闭。写回落地 commit / PR、验证结果和剩余风险，再读取当前状态：

- 已关闭：记录平台读回，接受 PR 自动关闭，不重复 mutation。
- 仍打开且验收通过：通过目标 tracker 关闭，再读回 closed / completed 状态。GitHub 使用
  显式仓库的 `gh issue close <id> --repo <owner/repo>` 和
  `gh issue view <id> --repo <owner/repo> --json state`；其他
  tracker 使用其状态转换接口。归档不能代替完成状态。
- 验收、身份、权限或读回缺失：记 `BLOCKED`，保留该 Issue，不用合并状态冒充验收通过。

完成标准：每个应关闭的直接 Issue 都有 closed-state readback；无对应 Issue 有查询依据。

## 3. 回收本次临时工作树

核对任务源 HEAD 已进入目标历史。Squash / rebase merge 可用同一 PR 的已审 head、
`MERGED` 与目标包含 merge SHA 证明落地；仅凭 PR 编号或 Issue 已关闭不足以回收。

逐树检查 `git status --porcelain=v1 --untracked-files=all`、ignored 文件、进行中的 Git 操作、
会话与进程占用。停止本任务服务并释放写权；其他写者仍在用的树保持原位。Dirty 或
不可重建的 ignored 文件先保全并验证恢复位置；无法证明可安全移除时记 `BLOCKED`。

先把交付物与收尾证据移到持久位置，再把执行目录切到保留的主工作区。只对清单内且已
证明可回收的树执行 `git worktree remove <path>`；命令拒绝时保留现场，不加 `--force`。
主工作区保持原位；不运行全局 prune、reset 或 clean 来制造 clean。

完成标准：`git worktree list --porcelain` 与文件系统均确认目标临时树已移除；主工作区及
其他任务的树保持原位。

## 4. 删除源分支

所有源分支工作树释放后重新核对本地 / 远端各自的 HEAD；它们必须仍与各自预期一致。
`main`、目标分支、受保护分支和出现新提交的源分支保留并报告原因。

- 本地源分支：从保留的主工作区执行 `git branch -d -- <source>`。Squash / rebase merge
  导致祖先检查拒绝时，仅在第 3 步的 PR 落地证据完整且本地 HEAD 等于已审 head 后，使用
  `git update-ref -d refs/heads/<source> <expected-head>`；其他拒绝保持 `BLOCKED`。
- 远端源分支：用 `git ls-remote --heads <source-remote> refs/heads/<source>` 读取真实状态。
  已不存在则记录；仍存在且 SHA 与远端预期一致时执行带预期 SHA 的删除：
  `git push --force-with-lease=refs/heads/<source>:<expected-remote-head> <source-remote> :refs/heads/<source>`。
  此命令只删除指定源 ref；权限、保护或 SHA 不符时保留并报告，目标分支不受此命令影响。

完成标准：本地 `refs/heads/<source>` 与远端 `ls-remote` 均证实源分支不存在；缺失权限、
分支新提交或拒绝删除均记 `BLOCKED`，不把 tracking ref 消失当成远端删除成功。

## 5. 读回与报告

读回目标 HEAD、主工作区分支和 `git status --short --branch`，核对目标验证通过、主工作区
仍在原定分支。本地合入 `main` 时主工作区应在 `main`；PR 的目标是其他分支时，单独核对
本地目标 ref 与 remote target 的 parity，保留主工作区原分支。
主工作区应 clean；预先存在且保留的无关改动单列，不能宣称 clean。逐项报告：

| 对象 | 必需证据 |
| --- | --- |
| 直接 Issue | tracker + ID + closed-state readback，或不适用依据 |
| 本地 / 远端源分支 | 名称 + 预期 HEAD + 删除后的查询结果，或不适用 / 明确保留依据 |
| 临时工作树 | 路径 + 移除后的清单与路径检查 + 交付物持久位置 |
| 目标与主工作区 | 目标 HEAD + 当前分支 + 状态 + post-merge check |

全部应关闭、应删除和应回收对象均有读回才报告 `COMPLETE`。缺一项就报告 `BLOCKED`，
区分已落地的代码与尚未完成的收尾，给出具体恢复动作；重试时读取现状，仅处理未完成项。
