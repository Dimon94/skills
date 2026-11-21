# 前向验证案例

用隔离项目和假的 tracker 重放，给评估会话原始输入，按实际 Spec 判断。真实远程和产品目录保持只读。

## 停止回合并保留已有结果

输入取自[共同样例](../../to-tickets/references/stop-turn/spec.md)。用户已在详情看到「第一段」，要停止生成，并继续查看已有内容。先读用户故事和源决定，再核对实际 Testing Decisions。

- S1 的 Given 指向已有「第一段」，When 点名详情中的停止操作，Then 同时要求显示已停止和原内容仍可读。`source` 能回到该决定，`seam` 可操作并读回。
- 只写“停止函数返回成功”即退回。用户无法从返回码确认已有内容是否保留。只有一次内部调用的检查需要补强；已有检查可以读回这两项时直接复用。
- 对共同样例运行 `check-spec.js --require-scenarios` 应通过。清空 source、重复 S1、从 covers 去掉 R1（即使旁文仍有 R1）均须报 `scenario`。默认入口仍可读历史散文式 Testing Decisions。

## 主路径：有状态的需求

输入：订单退款需求，包含退款失败重试和重复退款风险。

核对实际产物：

- Business Flow 有状态图，失败和重试是独立箭头，未列出的转移被禁止。
- 每个 T 和 R 都有唯一 owner Module，也都出现在 Testing Decisions。
- 重复退款规则点名了 `formal-verify-*` 或 `create-formal-verification-skill`。
- 没有用户故事复述转移；图中没有代码名。
- 每个新建或修改的 Module 的 Interface 用代码写：类型和函数签名，函数体留空，没有文件路径。
- 守住“只能退款一次”的签名带 `Ensures:`；这条 R 跨 Module 时，owner 下有 `Participants:`，参与方的 `Ensures:` 回引 R 编号。
- 没有给每个签名都写 `Ensures:`。
- Implementation Decisions 有 `architect` 选定的形状；图中每个状态（待支付、已支付、退款中、已退款等）恰好出现在一条 `Owns:` 行。

## 关键失败路径：无状态的需求

输入：只读列表增加一个筛选项，已有查询 Interface 和测试。

核对实际产物：

- Business Flow 写 `N/A` 和一句理由，没有装饰性状态图。
- 沿用现有 Module 和 Seam，没有新增只有一个 Adapter 的 Seam。

## 关键失败路径：新需求给既有分支链再加一支

输入：支付回调按订阅周期类型用 if/else 分流（首期跳过、续费履约）。新需求增加“试用转正”周期，履约规则与续费不同。

核对实际产物：

- Implementation Decisions 写明数据形状决定：改成“周期类型 → 处理方式”的表或状态字段，或者写明保留分支的理由。
- 没有在不说明的情况下给分支链加一个 `else if`，也没有加一个必须和周期类型同步的布尔标志。
- 选了新形状时，原有的每个周期类型都在新形状里有去处，Testing Decisions 覆盖新旧全部类型。

## 关键失败路径：需求不是一个 MMF

输入 A：优惠券需求，含运营建券、用户领券下单抵扣、运营核销报表。输入 B：只给 `coupon` 表加一个 `expires_at` 列，没有读写它的行为。

核对实际产物：

- A 判定为多个 MMF：没有写 Spec，停下请用户运行 `/to-epic`，列出至少两个 MMF 候选（如领券抵扣、核销报表）及各自的用户结果。
- A 改由编排方调用：同样不写 Spec，以 `NEXT: to-epic <理由>` 一行交回调用方，不对用户说「请运行」。
- B 判定为不足一个 MMF：没有写 Spec，说明它是某个 MMF 里的 ticket，点名所属 MMF 或写 Unknown。
- 两个判定都写出两个问题的答案和依据。

## 关键失败路径：MMF 来自带阻塞边的 Epic

输入：Epic 候选表里，“退款导出”对“销售导出”有一条上线边（依赖生成结果 Interface，解除证据为销售导出上线）；销售导出的 Spec Issue 已发布，定时导出依赖退款导出、尚未发布。

核对实际产物与写入：

- Dependencies 节的 `Blocked by:` 照抄这条上线边，写明可并发开发、验收等销售导出上线；`Blocks:` 点名定时导出及其消费的 Interface。
- 与销售导出 Spec Issue 之间连了 tracker 原生阻塞关系并读回；定时导出的边只留正文。
- `check-spec.js` 通过 stdin 核对正文并输出 `ok`，持久计划只见于 Spec Issue。
- 已有同 Epic／MMF 的 Spec 时复用原链接。Epic 下的 Spec 用已获认领的 lane 发布，并交回坐标及待连关系供 coordinator 汇总。直接给 Epic 和 MMF 时进入同一交付入口。缺测试 Seam 确认时等待用户。

## 留存证据

记录输入、实际 Spec 和未通过项。未执行的案例标为未验证。
