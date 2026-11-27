# 批量与栈式 PR 落地

你对落地到主干的代码负责。逐个 PR 独立验证，从栈底起只合连续已验证区间，落地期间不触碰栈结构。

单个 PR 的 Review Packet、预览门、合入、parity 读回与收尾由 [`gh-merge-pr`](../../gh-merge-pr/SKILL.md) 承担；本剧本拥有多 PR 与栈式合入的排序、verdict 延续与止步边界。合并 PR 属于远端写操作，必须先有用户明确授权。

1. **逐个 PR 独立验证。** 用 `gh` 读写 PR 状态。每个 PR 由未写该代码的独立验证者按真实使用路径（`verify-*` 或等价公开入口，对比 base 与 head）叠加 [`code-review`](../../code-review/SKILL.md) 给出 `PASS`、`PASS+NOTES` 或 `FAIL`。绿 CI 和自动 bot 批准不算 verdict，作者自测不算独立验证。完成条件：待合入栈中的每个 PR 都有独立 verdict 记录。
2. **锁定从栈底开始的连续已验证区间。** 从最低位未合并 PR 向上走，遇到第一个不是 `PASS` / `PASS+NOTES` 的 PR 立即停下。其下方的 PR 组成本次合入区间，最上面一个为 ceiling。落在未验证 PR 上方的已验证 PR 留在队列外等待；若它不依赖下方代码，可先 rebase 到主干并在主干上重新取得独立 verdict 后单独合入。完成条件：区间清单、顺序和 ceiling 明确。
3. **重核 verdict 是否仍覆盖当前 head。** 栈式 rebase 会改写上方每个 PR 的 SHA。复用旧 verdict 前，比较 verdict SHA 与当前 head 的 `git patch-id`：
   - `patch-id` 相同：patch 审查事实可候选延续，但新 base 的依赖、调用方与运行环境可能变化，当前 head 仍须通过自己的必需检查。
   - 差异仅在测试、文档或 lint 配置：若某条构建型验证通道在两个 SHA 的构建产物除可复现噪声（同 SHA 两次构建也存在的差异，或内嵌 commit SHA）外一致，该通道结果可保留，并逐项报告噪声类型与文件；测试、文档或 lint 改动本身仍须通过新检查并接受审查。
   - 无构建产物可比对的通道（如 dev server 或纯运行时验证）以及其余发生漂移的通道：必须重跑。
   完成条件：区间内每个 PR 在当前 head 上都有有效 verdict 与新鲜检查。
4. **自底向上逐个合入。** 每次只合区间内最低位未合并 PR，经 [`gh-merge-pr`](../../gh-merge-pr/SKILL.md) 执行预览门、合并、parity 读回与收尾：
   - 合并后用 `gh pr view <pr> --json state,mergedAt,baseRefName,mergeCommit` 读回结果，确认状态为 `MERGED` 且目标分支为主干；进入 merge queue 或开启 `--auto` 仍是等待态，不算已落地。
   - 仅当 verdict 覆盖当前 head 且获用户授权时才可启用 `--auto`。
   - 当前 PR 落地后，将紧邻其上、原 base 指向它的 PR 重指主干（`gh pr edit <pr> --base <trunk>`），把它的 patch 移到最新主干上并用 `git push --force-with-lease` 推送；按第 3 步判定其 verdict 延续，检查全绿后再合入下一个。
   完成条件：当前 PR 读回 `MERGED` 且下一层已完成 retarget 与重核。
5. **落地期间不动其余栈分支。** 除第 4 步对下一个待合 PR 的 retarget 与 rebase 外，不改动栈上任何分支或 base；父 PR 合入后子 PR base 自动移向主干属正常现象。合并卡住时先查明阻塞原因，再决定操作。完成条件：到达 ceiling，且无计划外分支改写。
6. **在 ceiling 停下。** 扩大合入区间需要新的独立 verdict，必须回到第 1 步重新开始。

回复写四项：已验证区间与 ceiling；每个 PR 的 verdict 与验证者；已落地 PR 及其读回证据（merge SHA、目标分支）；下一个缺口需要什么。
