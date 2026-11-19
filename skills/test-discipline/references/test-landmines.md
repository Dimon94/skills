# 测试地雷目录

本文件是测试机械门禁的唯一规则目录。建档用它为目标项目选门禁，hook 与 test-review 只引用它。思路来自 [landmines](https://github.com/interfere-inc/landmines)：agent 为了变绿会写出能过 CI 却不真实的测试；把诚实的写法变成唯一能过 lint 的写法，报错文本直接写出改法，agent 在同一轮修好。

## 三条做法

1. **门禁在 CI。** 规则由项目已有 linter 执行，接进 CI 必跑步骤；skill 文本和 hook 提醒只辅助，不替代门禁。
2. **报错即改法。** 每条诊断写“禁止什么、改成什么”，不只写“违规”。
3. **存量只减不增。** 存量违规进豁免清单，新文件全禁。工具支持按文件计数时用计数，违规减少即下调额度；只支持按文件豁免时，清单只删不加。

## 五类地雷

| 地雷 | 禁止 | 改成 | 合法例外 |
| --- | --- | --- | --- |
| 固定等待 | 测试或钩子里按固定时长等待：`sleep`、`setTimeout`、`waitForTimeout`，含 `act`、`.then` 等立即执行回调里的等待 | 等被测操作完成或它发出的事件：locator 断言、`waitForResponse`、事件、队列读回 | 让出一次调度的零时长等待；被测合同本身是时长（过期、限流）时用可控时钟 |
| 掩盖不稳定 | 测试重试、调高单测或全局超时：Vitest/Playwright `retries`、`test.setTimeout`、`test.slow`、pytest rerun/flaky | 找到依赖的事件并等待它；慢的共享准备移到 `beforeAll`/session fixture | 无。重跑才过就是不稳定测试，登记修复 |
| 替换被测代码 | mock 被测 owner 或其私有实现：模块 mock、`vi.fn(impl)`、`unittest.mock.patch` 项目模块、`monkeypatch.setattr` 私有名（`_` 开头） | 真实实现 + 外部边界替身 | settings、环境变量、时钟、网络、第三方 SDK；只观察不改行为的 spy |
| 松网络替身 | 网络替身放行未登记请求，未拦截的请求打到真实网络 | MSW `onUnhandledRequest: "error"`；respx `assert_all_mocked`；pytest-socket 禁网；Playwright `route` 兜底 abort | 测试本就针对真实外部服务且已获授权 |
| 无信号轮询 | 带截止时间反复读 spy、请求记录器或共享状态：`expect.poll`、`vi.waitFor`、`deadline` 循环 | 等待被测代码发出的事件或返回值 | 外部系统不提供事件时，用有界等待并说明原因 |

## 按语言落地

先用项目已有 linter；只有它表达不了规则时才引入 ast-grep。建档不安装依赖，只记录推荐配置与需要安装的项。

| 语言/框架 | 工具 | 覆盖 | 豁免机制 | 实测 |
| --- | --- | --- | --- | --- |
| TS + Vitest/Jest/MSW，用 Oxlint | `@interfere/landmines` 的 `landmines-testing` 插件；只启用这一组，style/types/structure 组是作者偏好 | 五类全覆盖 | 内建按文件精确计数，违规变少即报错要求下调 | 未实测 |
| Playwright，用 ESLint | `eslint-plugin-playwright`：`no-wait-for-timeout`、`no-slowed-test`、`no-skipped-test`、`no-focused-test`、`no-networkidle` | 固定等待、调高超时 | ESLint 批量抑制按文件计数，`--prune-suppressions` 下调 | 规则名已核对 2.12.2 包 |
| Playwright 或 TS，用 Biome 2 | GritQL 插件：`` `$page.waitForTimeout($ms)` ``、`` `test.setTimeout($n)` ``、`` `test.slow()` `` | 固定等待、调高超时 | `overrides[].includes` 只对测试文件挂插件，`!<文件>` 列存量豁免 | 2.5.6 实测，命中数与 grep 一致 |
| Python + pytest，用 Ruff | `TID251` banned-api：`time.sleep`、`asyncio.sleep`、`unittest.mock`；配置放测试目录的 `ruff.toml`，`extend` 主配置 | 固定等待、mock 模块 | 测试目录配置里的 `per-file-ignores` | 0.13.3 实测 |
| Python 私有替换 | ast-grep 规则：`monkeypatch.setattr($T, $NAME, $$$)`，`NAME` 匹配 `_` 开头或含 `._` | 替换私有实现 | 规则 `ignores` 列存量文件 | 0.51.3 实测 |
| Go，用 golangci-lint | `forbidigo` 禁 `time.Sleep`，`exclusions.rules` 限定非 `_test.go` 豁免 | 固定等待 | `new-from-merge-base` 只查新代码 | 未实测 |
| 任何配置文件 | 全局重试或超时写在 runner 配置里（如 `playwright.config` 的 `retries`），linter 常把配置文件排除在外 | 掩盖不稳定 | 无 | — |

`retries` 这类配置级开关由 test-review 逐项核对，不依赖 linter 覆盖。

## 机械规则的边界

- 私有名规则会把包住外部边界的私有函数（如 `_redis`、`_now`）也判为违规。改法是把这个边界做成显式参数或 fixture，再替换它；确属外部边界又暂不重构的文件进豁免清单。
- lint 只认写法，不认语义：断言是否有判别力、预期是否独立、测试是否保护需求，仍归 test-review。
- 不在测试里加行内抑制注释绕过门禁。确需例外时进豁免清单，由审查者看到。
