# 测试价值：用户结果与审查启发式

职责：记录一手资料研究，支撑 `test-review` 的启发式选择。Skill 的执行合同归 [SKILL.md](../../skills/test-review/SKILL.md)。访问日期统一为 2026-10-09。

结论：有价值的测试能识别具体行为错误，并容忍保持行为的实现变化。测试数量、覆盖率、运行速度、BDD/TDD 标签和断言语法都不能单独证明价值。

## 方法的边界

- **BDD**：用业务语言澄清行为及验收结果。Dan North 从 TDD 的困惑出发提出 BDD，并用 Given/When/Then 描述前置条件、动作和结果。[Introducing BDD，Dan North](https://dannorth.net/blog/introducing-bdd/)（访问：2026-10-09）。
- **TDD**：开发反馈过程。Kent Beck 先列行为场景，再逐个写可运行测试、从失败到通过、按需重构；他没有把遵循流程本身当作品质保证。[Canon TDD，Kent Beck](https://newsletter.kentbeck.com/p/canon-tdd)（访问：2026-10-09）。
- **单元/集成/E2E**：测试范围及依赖边界。Fowler 说明单元可以包含紧密协作的多个类，真实依赖与替身各有用途。[Unit Test，Martin Fowler](https://martinfowler.com/bliki/UnitTest.html)（访问：2026-10-09）。

推断：审查应分别确认“保护哪个结果”“如何取得判据”“覆盖哪段真实链路”。函数级测试可以保护金额舍入规则；UI E2E 也可能只检查静态标题。范围不能替代判别力。

## 七组审查关键词

以下“作者原意”是来源摘要；“审查反问、反例、可保留例外”是针对本任务推导的启发式。关键词用于定位候选，确认问题仍需需求、测试代码与运行证据。

### 1. 业务结果与可执行示例：Business outcome、Given/When/Then

**作者原意**：North 用领域语言命名行为，并把验收标准写为可执行场景。Gojko Adzic 强调以示例澄清需求；GWT 自动化不等于 BDD，模板不能替代协作分析。[North](https://dannorth.net/blog/introducing-bdd/)、[Specification by Example, 10 years later，Gojko Adzic](https://gojko.net/2020/03/17/sbe-10-years.html)（访问：2026-10-09）。

**审查反问**：谁在什么条件下做什么？用户、下游系统或持久状态应得到什么结果？失败时哪些副作用必须不存在？

**反例**：点击支付后只断言“支付成功”文案出现，未确认权益可读、金额正确或重复回调未重复发放。

**可保留例外**：文案本身是获确认的验收合同，如错误状态引导、无障碍名称、法定提示。通过真实状态触发再检查呈现，优于比较源码字符串。

### 2. 回归保护：Behavioral、Protection against regressions

**作者原意**：Beck 要求行为变化能反映到测试结果。Khorikov 把回归保护列为好测试的支柱，并指出覆盖率只能表明代码执行过，不能证明结果已验证。[Test Desiderata，Kent Beck 与 Kelly Sutton](https://testdesiderata.com/)、[Unit Testing 官方节选，Vladimir Khorikov，第 1 章与章节地图](https://enterprisecraftsmanship.com/files/Unit-Testing-Chapter-1-Excerpt.pdf)（访问：2026-10-09）。

**审查反问**：指出一个需求相关的错误实现，例如漏租户条件、金额翻倍、写入被跳过；这个测试会在哪里失败？

**反例**：对任意结果只检查非空；请求返回 HTTP 200 就当业务成功；关键断言位于未等待的异步任务中。

**可保留例外**：非空、无异常或 HTTP 状态本身就是该测试的合同，但其结论只能覆盖该合同，不能升级为整条业务成功。

方向固定：**false negative / 假绿** = 存在目标业务错误但测试通过；**false positive / 假红** = 目标行为没有回归却测试失败。推断：反事实检查先靠代码证据；必要时在隔离副本注入一个具体错误，不把全仓 mutation testing 当作默认门槛。

### 3. 独立预期：Independent oracle、自证、镜像

**作者原意**：Beck 把复制实际计算值到期望值列为 TDD 误用，因为这削弱了独立复核；他也指出无断言凑覆盖率及删除断言制造通过的问题。[Canon TDD，Kent Beck](https://newsletter.kentbeck.com/p/canon-tdd)（访问：2026-10-09）。

**审查反问**：期望来自独立需求、手算示例、标准向量或已审核基线，还是来自同一个被测实现？正确和错误实现能产生不同结论吗？

**反例**：实际值和期望值都调用同一金额函数；固定普通源码文件的 SHA256，只保护文件不变；AI 生成输出后直接更新快照来消除失败。

**可保留例外**：密码学标准向量、篡改检测、安装身份、发布产物完整性或确定性输出的字节合同。检查应证明合同成立或违规被拒；哈希相等只证明对应内容/身份，不能证明功能正确。快照经独立审阅且保护已确认的输出合同，也有价值。

### 4. 抗重构：Structure-insensitive、Fragile Test

**作者原意**：Beck 要求结构变化不改变测试结果。Fowler 指出验证内部协作调用容易耦合实现；这与验证最终状态是不同方式。[Test Desiderata](https://testdesiderata.com/)、[Mocks Aren't Stubs，Martin Fowler，“Coupling Tests to Implementations”](https://martinfowler.com/articles/mocksArentStubs.html)（访问：2026-10-09）。

**审查反问**：换一个等价算法、重命名内部 helper、移动文件或改调用顺序，为什么应让这个测试失败？

**反例**：读取源码后搜索函数名、私有字段、内部调用次序；普通 UI 标题改字就让大量快照失败，但行为没有改变。

**可保留例外**：检查真实构建产物或公开协议；调用次序确实决定外部副作用；需求明确锁定输出文案或视觉。先证明该结构是合同，再保留相关断言。

### 5. 真实边界：Predictive、State verification、Interaction verification

**作者原意**：Beck 的 Predictive 关注通过结果能否预测实际使用；Fowler 区分状态验证与交互验证，并说明替身对难以控制的协作有用。[Test Desiderata](https://testdesiderata.com/)、[Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html)、[Unit Test](https://martinfowler.com/bliki/UnitTest.html)（访问：2026-10-09）。

**审查反问**：被测行为真正执行了吗？哪些关键边界被替换？替身的假设由什么真实合同验证？

**反例**：mock 被测支付服务本身，再断言它返回成功；mock 数据库权限查询后声称租户隔离成立。

**可保留例外**：外部支付商、邮件服务或可控时钟的替身可用于失败、重试与路由场景。外发消息的收件人、金额、次数可能就是结果；同时明确尚未覆盖的供应商或真实数据库边界。

### 6. 稳定反馈：Deterministic、Isolated、Erratic Test

**作者原意**：Beck 要求同样条件产生同样结果，并避免测试次序影响结果。这里的 Isolated 指测试之间的影响，不等于所有协作者都必须 mock。[Test Desiderata](https://testdesiderata.com/)、[Unit Test，“Solitary or Sociable?”](https://martinfowler.com/bliki/UnitTest.html)（访问：2026-10-09）。

**审查反问**：时钟、随机数、共享库状态、并发及清理由谁控制？重试掩盖的是基础设施故障还是真实行为失败？

**反例**：固定 sleep 后碰运气读状态；多个用例共享账户余额；依赖上一用例留下的数据。

**可保留例外**：验证真实并发、时间与远程协作需要这些维度。用有界等待、隔离数据与明确失败证据降低噪声，保留正在检验的风险。

### 7. 可诊断与净价值：Specific、Assertion Roulette、Fast feedback、Maintainability

**作者原意**：Beck 强调失败应指向具体原因。Meszaros 的 Assertion Roulette 指多个断言失败时难以判断失败点，问题是诊断而非断言数量。Khorikov 要求权衡回归收益、误报、运行和维护成本；Fowler 建议把有价值的慢测试放到合适的流水线阶段。[Test Desiderata](https://testdesiderata.com/)、[xUnit Test Patterns，Gerard Meszaros，正式书预览第 16 章](https://www.oreilly.com/library/view/xunit-test-patterns/9780131495050/ch16.html)、[Khorikov 官方节选，第 1 章](https://enterprisecraftsmanship.com/files/Unit-Testing-Chapter-1-Excerpt.pdf)、[Unit Test，“Speed”](https://martinfowler.com/bliki/UnitTest.html)（访问：2026-10-09）。

**审查反问**：失败时能定位哪个用户结果被破坏吗？这个用例比已有测试多保护哪种错误？CI 耗时花在行为验证还是重复建库、安装与构建？

**反例**：重复参数只改变无关字段；一条不透明的大快照失败；每个用例重复创建整套迁移模板。

**可保留例外**：同一业务结果可以需要多项断言。必要慢测试先优化装置、复用或分阶段执行；移除前列出原保护场景及替代覆盖，不能只看速度。

## 补充：消融测试与 mutation testing

用户要求以“消融测试”确认测试的必要性。这里采用操作定义，不把它冒称为上述书籍的统一术语。

**来源事实**：PIT 的 mutation testing 会改变返回值、逻辑条件或移除方法调用，再检查测试是否失败。官方同时区分等价变异：行为不变或修改不涉及测试合同，不应据此认为测试不足。[PIT：Basic Concepts](https://pitest.org/quickstart/basic_concepts/)（访问：2026-10-09）。

**推断**：用一个需求相关错误检验目标断言，再在同一个错误实现下临时移除目标测试，观察剩余集合能否拒绝该错误，可帮助识别独有覆盖、重叠与假绿。正确实现删前删后都通过不能证明无价值；一个反例也不能证明整例在所有场景都冗余。具体执行定义归 [测试启发式：消融测试](../../skills/test-review/references/test-heuristics.md#消融测试证明独有保护)。AI 降低编写成本，不消除 CI、误报、审阅和维护成本。

## 对 test-review 的建议

1. 把上述关键词作为有名的判断启发式。搜索 `hash`、`snapshot`、`mock`、`readFile`、`toBeTruthy` 等只用于导航；报告必须落到具体行为错误或项目测试规范。
2. 每项重要测试建立“需求/结果 → 条件与动作 → 独立断言 → 能识别的错误 → 真实入口与 CI 执行证据”。缺证据标 Unknown。
3. Standards 检查项目规范、判据、替身、隔离和 CI 接线；Spec 独立检查目标结果、边界和删测后的覆盖。两轴分别报告。
4. 保留、改写、合并或删除以净保护价值判断。研究原则不覆盖目标项目明确要求；冲突说明规则坐标及原因。

## 研究限制

只读取公开作者页与正式书预览/节选；未购买或声称通读书籍。Meszaros 作者站抓取失败，Assertion Roulette 以正式书预览核验；其他 smell 名称只作导航，不借目录断言细节。本文示例是审查推断，未在实际 MR 验证，也未估计当前 CI 提速。该研究目录此前没有既有记录约定，采用带日期的单文件调查记录。
