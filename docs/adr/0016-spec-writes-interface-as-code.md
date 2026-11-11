# Spec 用代码写 Interface，验证和审查沿 Module 收敛

Status: accepted

Related: 修订 repo://docs/adr/0007-owned-to-spec.md §3 的“唯一 owner Module”；repo://docs/adr/0008-review-round-limit.md；repo://skills/to-spec/SKILL.md；repo://skills/implement/SKILL.md；repo://skills/code-review/SKILL.md；arXiv 2610.38214v1《Skeleton Coding: Program Structure as a Specification for Agents》

## Context

`to-spec` 沿用上游规则，禁止 Spec 带代码片段，理由是片段很快过期。同一节又要求每个 Module 写明 Interface、不变量、顺序约束和错误模式。两条叠加后，结构决定只能用散文写。

arXiv 2610.38214v1 在 3 个基准、4 个模型上比较了规格形式：

- 需要多少测试取决于实现的结构，结构由 agent 自选。行为类规格最多提高 9.4 个百分点通过率。
- 类型和函数签名（函数体留空）加逐函数合同、跨函数不变量，把平均测试错误率从 40.7% 降到 21.0%。
- 散文架构文档写到 4–7 倍长，仍低于同仓库上最好的代码形规格。
- 在最好的规格上再加正确但过细的合同，通过率下降。
- 整体重做的期望成本是各组件通过率倒数的乘积，按组件重做是它们的和（命题 3.1）。
- 合同措辞的松散度是误放行率的下限，更强的判官消不掉（命题 3.2）。

2026-11-11 用户批准按这四点改 `to-spec`、`implement` 和 `code-review`。

证据边界：论文的规格从隐藏的参考实现反推，不是人写的；任务是从零重建库和命令行工具；合同由模型判断，没有机器校验。人写 Interface 代码、在已有代码上增量修改时的效果为 Unknown，本决定属推断。

## Decision

### 1. Interface 用代码写

Implementation Decisions 里每个新建或修改的 Module，用目标项目的语言写类型和函数签名，函数体留空。选错会破坏 T、R 或调用方的签名带 `Ensures:`，其余只留一行说明。文件路径仍然不写。

被否决：保留散文 Interface，只放宽原型片段的例外。那样结构决定仍由实现 agent 自选，论文测到的差距就在这里。

被否决：给每个签名都写完整前后置条件。论文测到过细的合同会降低通过率。

不新造术语：Interface 已定义为 caller 正确使用 Module 必须知道的全部事实（repo://docs/agents/architecture-standards.md 第 2 节），本条只改它在 Spec 里的写法。被否决：论文的“骨架”，`vertical-slicing` 已用它指 walking skeleton；“签名桩”，读者要先学这个词才懂。

### 2. 跨 Module 的 R 列参与方

每条 R 仍有唯一 owner Module。R 要靠多个 Module 共同守住时，owner 下写 `Participants:`，参与方在相关签名的 `Ensures:` 里回引 R 编号。0007 §3 的“唯一 owner”保留，本条只增加参与方。

### 3. 修复后只重跑命中 Module 的检查

`implement` 修复 P0/P1 后，重跑命中 Module 的检查，其余 Module 的结论沿用。修复改了 Interface 时，连同它的调用方一起重跑。最后一轮修复之后跑一次完整测试命令。三轮上限和 verdict 规则不变。

### 4. 判不出对错的验收指回 Spec

Spec 某行的措辞容许两种可观察行为不同的实现时，`code-review` 的 Spec 轴不判实现对错，列为 Spec 缺口，不改变 verdict。`implement` 把它交给用户收紧措辞。

被否决：把 Spec 缺口记为 P2 并登记 issue。它的修复对象是 Spec 文本，不是代码，放进代码 issue 积压会找不到 owner。

## Consequences

### 正面

- 实现 agent 拿到的结构是 Spec 作者选的，不是它自己猜的。
- 修复轮的验证成本随命中 Module 数增长，不随整个 diff 增长。
- 措辞歧义回到 Spec 修，不消耗审查轮次。

### 负面 / 成本

- Spec 里的 Interface 代码会过期。实现偏离它时，只在交付说明里留痕，Spec 本身不回写。
- 写 Spec 的人要先定类型和签名，前期成本上升。
- 与上游 `to-spec` 的差异变大。

### 边界

不规定 `Ensures:` 的覆盖率，不引入机器校验的合同，不改 `vertical-slicing` 的阻塞边规则和模型选择。真实 Spec 显示这些 Interface 反复在实现阶段被推翻时，重开本决定。行为效果未经真实 Spec 验证，见 repo://skills/to-spec/references/verification.md。
