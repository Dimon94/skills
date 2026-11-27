# 工作树与本机缓存磁盘回收

本剧本会删除本机状态且没有 code review 兜底，下列门禁即审查本身。常规单任务合入后的回收归 [`git-worktree`](../../git-worktree/SKILL.md) 第 5 节（`worktree.sh gc --apply`）；本剧本用于批量清理废弃工作树、外部工具工作树（如 T3 / IDE 树）以及模拟器与缓存释放磁盘。

1. **快照并全量盘点。** 先记录 `df -h /`。从 `git worktree list --porcelain` 枚举所有工作树路径，绝不凭记忆手敲目录（避免漏掉 `.cursor/worktrees/`、`*.wt/` 或其他工具目录，按 `principle-encode-lessons-in-structure`）；托管任务树同步运行 `worktree.sh ls` 与只读 `worktree.sh gc`。逐树采集：体积、修改时间、是否已合入目标基准（PR 指向非默认分支时显式对照 `origin/<branch>`）、已跟踪未提交改动数（`wip:N`）、未跟踪临时文件数（`scratch:N`）、关联 PR 状态及占用进程（`lsof`）。耗时扫描放后台执行。完成条件：拿到清理前 `df -h /` 与全量工作树分类表。
2. **分类只是建议，不是删除授权。** 活跃或置顶会话才是使用真相（按 `principle-prove-it-works`）。先从用户或宿主侧边栏核对当前置顶与进行中会话，与每条候选交叉比对；工具标为 `safe` 但仍被置顶会话使用的树一律保留。
3. **交只读子代理核查疑似在用的树。** 对近期有会话记录或归属存疑的工作树，按 `principle-guard-the-context-window` 派只读子代理查对应会话记录（记录体量大，不倒进主上下文），回报该会话是否仍在进行/置顶，以及是否派生了复现树或兄弟工作树。完成条件：每条候选的占用状态均有证据，无猜测。
4. **不可逆丢失必停。**
   - `wip:N`（已跟踪未提交改动）：删除干净工作树可从分支恢复，未提交改动一删即永久丢失。必须先展示 `git diff` 并等用户明确决定。
   - `scratch:N`（未跟踪临时文件）：删除前逐一列出文件名。
   - 按自主权边界：干净、已合入且确认无会话/进程占用的树可继续回收；`wip`、未合入或仍在使用的树一律暂停保留。
5. **按确认集合执行回收并复核。**
   - `worktree.sh` 托管树：先在主工作区运行 `worktree.sh gc --apply`（四条件安全回收，不加 `--force`）。
   - 其余用户明确确认删除的废弃树或外部工具树：执行 `git worktree remove <path>`；仅在确认零未提交丢失且目录因 ignored 构建产物残留时才补 `--force` 或清理残余目录，随后执行 `git worktree prune`。分支 ref 默认保留，除非用户一并授权删除。
   - 重跑 `df -h /` 与 `git worktree list --porcelain` 核对结果。
   完成条件：目标树已从清单和磁盘移除，清理前后 `df -h /` 差值已记录。
6. **磁盘仍紧张时清理模拟器与本机缓存（macOS）。** 只清用户未声明保留的缓存，涉及不可逆缓存先列体积并征询确认：
   - iOS 模拟器：`xcrun simctl --set testing delete all`（XCTestDevices 克隆）、`xcrun simctl delete unavailable`，用 `xcrun simctl runtime list` 查旧 runtime 并经确认后 `xcrun simctl runtime delete <id>`。
   - 其他大头：Xcode `DerivedData` 与 `iOS DeviceSupport`、IDE 备份/快照目录、包管理器缓存（`pnpm`、`uv`、`brew`、`yarn`）。

回复写三项：清理前后 `df -h /` 与释放空间；已清理的工作树与缓存清单；每条保留项的一行原因（被哪个会话/进程占用，或存在未提交/未合入改动）。
