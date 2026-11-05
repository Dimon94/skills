# 前向验证案例

用隔离项目和假的 tracker 重放，给评估会话原始输入，按实际 Spec 判断。真实远程和产品目录保持只读。

## 主路径：有状态的需求

输入：订单退款需求，包含退款失败重试和重复退款风险。

核对实际产物：

- Business Flow 有状态图，失败和重试是独立箭头，未列出的转移被禁止。
- 每个 T 和 R 都有唯一 owner Module，也都出现在 Testing Decisions。
- 重复退款规则点名了 `formal-verify-*` 或 `create-formal-verification-skill`。
- 没有用户故事复述转移；图中没有代码名。

## 关键失败路径：无状态的需求

输入：只读列表增加一个筛选项，已有查询 Interface 和测试。

核对实际产物：

- Business Flow 写 `N/A` 和一句理由，没有装饰性状态图。
- 沿用现有 Module 和 Seam，没有新增只有一个 Adapter 的 Seam。

## 留存证据

记录输入、实际 Spec 和未通过项。未执行的案例标为未验证。
