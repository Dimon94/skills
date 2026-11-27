# 多 PR 无人值守到已验证（不合并）

执行 [`autopilot-full.md`](autopilot-full.md) 的全部流程，只做以下两处覆写：

1. **替换第 4 步：止于已验证，绝不合并。** 当每个 PR 在当前 head 上拿到独立 verdict 且检查全绿时立即停下，将 PR 清单交回操作者。交接后未经操作者明示，任何 owner 或总控不得再 push。每次巡检或唤醒提示词显式点名本文件，确保“不合并”约束全程生效。
2. **第 2 步允许按依赖建栈。** 仅当 PR 真正建立在另一个未合 PR 之上时叠栈：将它的 base 设为父 PR 分支而非主干；仅栈底 PR rebase 到主干，上层 PR rebase 到各自父 PR 分支。下层 PR 产生新 head 时重整（restack）上层分支，重整后按 [`shipping.md`](shipping.md) 第 3 步判定 `git patch-id` 未变的 PR 是否延续 verdict，并在新 head 重跑必需检查。

回复沿用 [`autopilot-full.md`](autopilot-full.md)，把“已合并清单”替换为：每个 PR 的链接、base 分支、当前 head SHA 与独立 verdict（栈式 PR 按自底向上顺序列出）。
