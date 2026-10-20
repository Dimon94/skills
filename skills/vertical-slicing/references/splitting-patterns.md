# 拆法库

职责：给 `vertical-slicing` 的加厚步骤和结构/收尾步骤提供拆法和隐藏手法。来源摘要与原文链接见 [研究记录](../../../docs/research/2026-10-20-vertical-slicing-heuristics.md)。

## Meta-pattern

先找核心复杂度，列出它的变体，再把变体缩成一条完整路径。这条完整路径进骨架，其余变体各成一片加厚。

## 变体拆法

按 SPIDR 与 Humanizing Work 的拆分模式选。同一需求可以叠用。

| 拆法 | 第一片取 | 后续片加 |
| --- | --- | --- |
| Paths / Business Rule Variations | 最常走的一条路径，如单一支付方式 | 其他路径，如 Apple Pay、退款 |
| Rules | 放宽后的规则，如不校验库存 | 逐条补回规则 |
| Data / Data Variations | 一种数据形态，如只支持人民币 | 其他形态 |
| Interfaces / Data Entry Methods | 最简单的界面或单一终端 | 其他终端、更好用的输入方式 |
| Workflow Steps | 首尾两步走通，中间步骤硬编码 | 中间步骤逐个补回 |
| Operations（CRUD） | 一对能闭环的操作，如 Create + Read | 其余操作 |
| Simple/Complex | 「最简单的版本是什么」 | 复杂情形逐个补回 |
| Defer Performance | 慢但正确的版本 | 性能优化片；前提是性能不是本片的验收合同 |
| Spike | 只在其他拆法都答不了未知时用；产出是答案 | 依据答案切出的行为片 |

骨架里的 CRUD 片要能让人看到写入结果。Workflow 片要首尾都在，不先做中间。

## 隐藏手法

未完成工作也合入 main 并部署，用以下手法控制可见性或分阶段迁移。

| 手法 | 用在 | 换用其他手法 | 收尾片 |
| --- | --- | --- | --- |
| Release toggle | 用户可见的新功能分多片完成；toggle 存活一两周以内 | 替换内部实现或改 Interface | 打开 toggle，删 toggle 与旧路径 |
| Dark launch | 新的后端行为要在公开前验证负载；它增强已有交互 | 需要用户主动选择的功能，改用 canary；有不可撤销副作用的调用（扣款、发消息） | 公开 release，删 dark 路径开关 |
| Branch by abstraction | 替换内部 Module（库、存储、框架），调用方多，耗时数天以上 | 调用方很少、当天能改完 | 删旧 Adapter；只剩一个 Adapter 时考虑删 seam |
| Expand-contract | 向后不兼容的 Interface 或 schema 变更，调用方要逐步迁移 | 只有一个调用方且能原子修改 | 确认无调用方后删旧 Interface 或旧列 |

组合：内部替换用 branch by abstraction；Interface 或 schema 变更用 expand-contract；两者都保持用户可见行为不变。用户可见的新功能用 release toggle，需要先验负载时叠加 dark launch。

Toggle 判断放在 seam 上的单一位置，不散布到各调用方。Expand-contract 的迁移批次按影响面切分，每批一片，都被 expand 片阻塞；contract 片被所有迁移批次阻塞。
