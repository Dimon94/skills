# 阶段门禁子线程派发包

用于派发一个非实现类门禁子线程：PRD 合成、issue 拆分、只读 review
或证据收集。

```text
项目：
父编排线程：
门禁：prd | issues | review | evidence
路由 skill：/to-prd | /to-issues | /code-review | none
基线分支：
基线提交：

真相源坐标：
- Wayfinder map issue：
- PRD：
- Tracker issues：
- Research/prototype artifacts：
- Source worktree：

目标说明：
- 如果 Source worktree 不是可创建 Codex 线程的 project target，就在已创建
  的项目线程里把这些绝对路径当作只读证据读取。

允许范围：
- 可以写入/发布：
- 只读：
- 禁止范围：

停止条件：
- 如果需要用户判断、缺少证据、tracker 鉴权失败、真相源冲突或需要改代码，
  立即停止并报告。

预期产物：
- PRD URL/body | issue split proposal/issue URLs | review report | evidence

`prd` 和 `issues` 门禁的 tracker 发布保护：
- 创建 issue 前，先搜索/读取 tracker。先用当前批准 PRD/slice 的精确标题、关键
  acceptance code literals、父 PRD URL/ID、source map issue/artifact 名称做精确搜索；
  再用宽关键词做候选搜索。
- 只有同时满足这些条件，才算 duplicate 并停止：同一个门禁类型、同一个当前批准
  PRD 或同一个 slice、相同 acceptance/禁止范围，并且 tracker body 明确指向当前
  父 PRD/source 坐标或同一份发布意图。
- 以下只算 candidate overlap，不能直接当 duplicate：旧迁移 GitHub issue、明显更宽的
  历史 PRD、只靠宽关键词命中的旧低 IID issue、挂在旧父 PRD 下的实现 slice、closed
  或 stale 项、只覆盖部分术语但 acceptance/禁止范围不同的项。
- `prd` 门禁没有现有 PRD 坐标时，implementation issues 不能替代 PRD duplicate。
  只能把它们列为相关候选；除非已有 PRD issue/doc 明确捕获当前批准 slice，否则继续
  发布新 PRD 或停止询问用户。
- `issues` 门禁只在同一个已批准 PRD 父项下判断子 issue duplicate；旧父 PRD 下的同名
  slice 只能列为迁移/复用候选，不能阻止当前 issue split。
- 不要用 IID 大小做唯一依据；低 IID 通常是历史信号，高 IID 也不保证当前。最终以
  tracker body、父子关系、source 坐标、acceptance/禁止范围为准。
- 不要把 Markdown 正文塞进 shell 引号里的 inline string。使用临时 body 文件、
  JSON encoder，或 tracker helper 的文件输入，确保反引号、checkbox、`$`
  和引号原样保留。
- 按依赖顺序发布。每次 create/update 后立刻读回 tracker issue，核对标题、
  label、父引用、依赖文本、checklist 数量，以及源正文里的代码字面量。
- 如果 create/update 部分成功或读回失败，停止。final report 必须列出所有已
  创建 ID、失败字段，以及 rerun 是否会造成重复工作。

执行规则：
- 使用 fresh session。
- 需要分支时，只在本 worktree 目录内创建/切换；不要切换主目录/source worktree 的分支。
- 不要再派发子线程。
- 不要进入 `/implement`。
- 不要集成、push、打开/更新 PR/MR，也不要评论 PR/MR。
- 在本子线程 final answer 中输出完整 final report。
- 如果 `send_message_to_thread` 可用，final report 准备好之后，向父编排线程
  发送一个紧凑 handoff。
- 如果无法 handoff 给父线程或 handoff 失败，在 final report 里说明。

Final report：
门禁：
状态：completed | blocked
线程：
产物：
父线程 handoff：sent | unavailable | failed <reason>
已使用的真相源坐标：
-
验证：
-
`prd`/`issues` 门禁创建的 tracker items：
- <id/url, readback status, dependency state>
Duplicate/candidate decision：
- <exact duplicate | candidate overlap | none, ids/urls, reason>
阻塞：
-
下一门禁建议：prd | issues | dispatch | integrate | remote-review | ask-user | blocked

父线程 handoff message：
门禁：
状态：
线程：
产物：
阻塞：
下一门禁建议：
```
