# formal-verify-delivery-cycle 覆盖记录

Sync commit：`44158e12ec662cef8f29991c76630ea610616f62`（delivery-cycle 代码在此提交上已核对与本验证一致）。
函数坐标按该提交的 `skills/delivery-cycle/scripts/delivery-cycle.js` 行号。

## 性质

每条性质一句话说明承诺，一句话说明坏了的后果。检查点在 `scripts/verify.js` 与 `scripts/world.js`。

| ID | 性质 | 坏了的后果 | 检查点 | Spec |
| --- | --- | --- | --- | --- |
| R8 | 发送 `patchIssue` 时，若时钟已跨周一，或本轮最后一次前读已在 `cycle-1`，就不写 `cycle-0` | 已滚入新周的工作被拉回已结束的旧周 | `World.checkSend` | DD-540 R8，DD-545 |
| R9 | 每次 `patchIssue` 前，本轮对该 Issue 有一次可读的前读，且前读证明 patch 的每个字段仍需要 | Unknown 或失败后盲重放，或对已符合的 Issue 重复写 | `World.checkSend`、`needed` | DD-540 R9，DD-544 |
| R9V | `write: 'verified'` 的项，在该轮最后一次 `patchIssue` 之后有一次满足 patch 的回读 | 平台只回了 `success: true` 却没写入，结果谎报已同步 | `checkResult` | DD-540 R9 |
| R9S | `status: 'synchronized'` 时没有 `failed`／`unknown` 项，也没有阻断类 problem | 部分成功冒充整批成功，用户不再重跑 | `checkResult` | DD-540 R9、R11 |
| R11 | 环境冻结后的第二次重跑（run3）零 `patchIssue`，`changed = 0` | 稳定状态下重复写入或虚报变更 | `checkIdempotent` | DD-540 R11，DD-544 |

## 覆盖的函数

| 函数 | 坐标 | 关联性质 |
| --- | --- | --- |
| `maintainCurrentWeek` | delivery-cycle.js:176 | 全部（被测入口） |
| `recordBlocked` | :205 | R9S |
| `applyEach` | :213 | R9、R11 |
| `readWeekCycles` | :296 | R8 |
| `applyPicks` | :521 | R9（exclude 场景） |
| `record` | :543 | R9V、R11 |
| `patchClaim`、`writePatch` | :551、:558 | R9V |
| `readState` | :567 | R9 |
| `patchFor` | :575 | R9、R11 |
| `classifyReadback` | :588 | R9V、R9S |
| `applyTarget` | :599 | R8、R9 |
| `preRead` | :614 | R8、R9 |
| `scheduledLater`、`skipLater` | :626、:634 | R8 |
| `recheckWeek` | :652 | 只作 await 注入点；它守的配置漂移不在性质内（见走查记录） |
| `readBack` | :662 | R8、R9V |
| `ensureClock` | :673 | R8 |
| `finish` | :684 | R9S |

环境侧依赖 `skills/delivery-cycle/tests/fake-adapters.js` 的 `FakeLinear`（`nativeRoll`、`applyPatch` 增量语义）。

## 原子步骤与代码 await 点

本有界模型把一次 port 调用抽象成一步，并在其进入前插入环境事件。这是探索边界的假设，不是 JavaScript 对远端平台的原子性保证。真实请求在途期间的任意远端交错、响应快照时点及多进程行为不在本模型内。

| 模型步骤 | 代码 await 点 | 进入前可注入 |
| --- | --- | --- |
| 读当周 Cycle | `readWeekCycles` → `linear.listCycles`（入口 `findCurrentCycle` 与 `recheckWeek` :653） | 原生滚动、手动移动、跨周一 |
| 前读 | `preRead` → `readState` :616 | 同上；读超时 |
| 写 | `applyTarget` → `writePatch` :606 | 先核对 R8／R9（发送时刻），再注入同上事件；然后选写结果 |
| 回读 | `readBack` → `readState` :663 | 同上；读超时 |

`readCycleConfiguration`、`readLabel`、`listIssues` 不注入（含 44158e1 新增的配置读不全时观察 Cycle 长度分支 `observedNonWeekly`，它在任何写入之前、只追加 problem）：它们在第一次 `listCycles` 之前或之后紧邻，注入点已被相邻的 `listCycles` 覆盖。`evidence.read` 恒为 `not_met`，不注入。

写结果（`world.js` 的 `PATCH_OUTCOMES`）：`ok`、写入后超时、写入前超时、写入后空响应体、`errors` 拒绝、`permission_denied`、回 `success: true` 但未写入。

## 有界与假设

- 场景 `carry`：P1（无 cycle）、P2（在 `cycle-0`）、P3（无 cycle），都是进行中 MMF 父项，证据 `not_met`；时钟从上海周日 23:59:59（`cycle-0` 周）开始。
- 场景 `exclude`：P1 在 `cycle-0` 且被 `exclude`，P2 无 cycle 待纳入。
- 每条轨迹在同一 Linear 状态上连跑 4 次 `maintainCurrentWeek`。run0、run1 共享预算：环境事件 ≤ 2（原生滚动一次、他人把 P1 手动移入 `cycle-1` 一次、跨周一一次，三选二），故障 ≤ 2（读超时或非 `ok` 写结果）。run2 冻结环境作为恢复轮；run3 冻结并检查 R11。
- 规模（c897020 与 44158e1 上实跑，计数相同）：`carry` 160126 条轨迹，单条最多 39 个选择点，其中 12001 条含前读之后的未观察覆盖；`exclude` 85310 条轨迹，最多 30 个选择点。合计约 33 秒。
- 环境假设：Linear 写入对单个 Issue 原子生效、增量语义同 `applyPatch`；原生滚动每周期一次；`readIssue` 返回发送时刻的最新值；时钟单调。

## 不覆盖

- 无 CAS：前读之后、写入到达之前的他人写入会被覆盖（`unobservedRaceTraces`）。本验证只计数，不当作违反；Spec R8 也只承诺已观察到的不回移。
- 子项 ticket、结转、正式交付判断（`assessFormalDelivery`、`placement`、`groupMMFs`）、`restore` 选择、分页异常、配置不合规、scope／身份漂移。
- 超过 3 个 Issue、超过 2 次环境事件或故障、并发的两个 `maintainCurrentWeek` 进程。
- 真实 Adapter（`linear-graphql.js`、`evidence.js`、`run.js`）与真实 Linear 平台行为；它们由 DD-545 真实验收负责。

## 工具选择

本机无 JVM，TLC／Apalache 不能直接运行；JS 没有已安装的代码级验证器。手写 TLA+ 模型还要再复刻一遍业务规则，存在模型与代码漂移的风险。所以选有界穷举调度探索：直接运行真实 `maintainCurrentWeek`，在每个 port `await` 前用 DFS 枚举全部环境与故障选择。代价是只覆盖上表的界，不是无界证明。

## 失败证明（c897020）

`scripts/mutants.js` 就地写入 scratch 变体、跑 `verify.js`、写回原字节并比对 sha256（原文件 `d1176cdbf5ae7c1bedb5df02dfddaebbed4c79cb7d438a24a9ed041779b222da`）。

| 变体 | 破坏 | 被捕获的性质 |
| --- | --- | --- |
| `drop-observed-expiry` | `scheduledLater` 直接返回 false | R8 |
| `drop-clock-check` | `ensureClock` 直接返回 | R8 |
| `skip-pre-read` | `applyTarget` 用计划时的 Issue 代替前读 | R9 |
| `send-when-conforming` | 删掉空 patch 的 `unchanged` 早退 | R9 |
| `trust-claim-without-readback` | `classifyReadback` 见 `accepted` 即 verified | R9V |
| `count-unchanged-as-changed` | `record` 把 `unchanged` 计入 `changed` | R11 |
| `partial-as-synchronized` | `finish` 把 partial 记为 synchronized | R9S |

## 按 Skill 走查（c897020）

按 SKILL.md 第 1、2 节冷启动跑两次 scratch，结束都用 `cp` 写回原字节，sha256 回到 `d1176cdb…b222da`，`git status` 不再列出 delivery-cycle.js。

1. 删掉 `applyTarget` 的 `await recheckWeek(deps, run);`（:604）：第 1 节命中，`verify.js` 仍 PASS（carry 103331、exclude 55989 条轨迹）。原因：`preRead` 在读后已调用 `ensureClock`（:618），到 `writePatch` 之间不再有 await，五条性质都不靠它守。它守的是当周 Cycle 边界变化（`configuration_mismatch`）与新增未来 Cycle，这两项在不覆盖范围内。
2. `writePatch`（:558）在异常后不读直接重发同一 patch：`verify.js` 退出码 1，报 `VIOLATION R9 run1 P3: 发送前没有本轮可读的新前读（盲重放）`，轨迹为 run1 中 `patchIssue P3 {"cycle":"cycle-1"} → timeout_after_apply` 后紧跟第二次 `patchIssue P3`，而该轮仍报 `synchronized changed=3`。
3. 还原后重跑原实现：PASS，轨迹数与“有界与假设”一节相同。
