---
name: formal-verify-delivery-cycle
description: "有界穷举检查 delivery-cycle 维护入口的时序与重试性质（R8 不写回旧周、R9 先读后写不盲重放、verified 必有回读、partial 不冒充 synchronized、R11 重跑零写入）。改动 skills/delivery-cycle/scripts/delivery-cycle.js 的执行、前读、写入、回读、时钟或结果判定代码，或改 tests/fake-adapters.js 时使用。"
---

# formal-verify-delivery-cycle

在每个 port `await` 前穷举注入原生滚动、他人手动移动、跨周一与写读故障，跑真实 `maintainCurrentWeek`，检查五条性质。这是有界调度探索，不是无界证明，也不代替真实 Linear 验收。

## 1. 判断改动是否命中

```bash
git diff --stat 44158e12ec662cef8f29991c76630ea610616f62 -- skills/delivery-cycle/scripts/delivery-cycle.js skills/delivery-cycle/tests/fake-adapters.js
```

有输出即命中。覆盖的函数与性质见 [references/coverage.md](references/coverage.md)。只改 `assessFormalDelivery`、身份分组或 Adapter（`linear-graphql.js`、`evidence.js`、`run.js`）不命中，跑普通测试即可。

## 2. 运行

前置：Node.js 22（已核实 v22.22.0）。无其他依赖，可离线运行。

```bash
node skills/formal-verify-delivery-cycle/scripts/verify.js
```

约 35 秒。退出码 0 且末行 `RESULT: PASS` 才算通过。可只跑一个场景：追加 `carry` 或 `exclude`。未知场景退出码 2，不执行探索，不输出 PASS。

改了覆盖代码的判断分支后，再证明检查仍能失败（约 5 分钟，会就地写入并还原 `delivery-cycle.js`，要求该文件无未提交改动）：

```bash
node skills/formal-verify-delivery-cycle/scripts/mutants.js
```

末行 `MUTANTS: ALL CAUGHT` 且 `identical=true`。`MISSED` 或锚点不存在表示 `mutants.js` 跟不上代码，按第 4 节更新。退出码 2 表示还原失败：先 `git diff -- skills/delivery-cycle/scripts/delivery-cycle.js` 核对，再用 `git checkout -- skills/delivery-cycle/scripts/delivery-cycle.js` 恢复。

## 3. 读结果

`VIOLATION <性质> run<n> <Issue>: <原因>` 之后是一条按代码名词讲的轨迹：`readIssue`、`patchIssue`、环境事件和每轮 `maintainCurrentWeek` 结果。`choices=[...]` 是该轨迹的选择序列。

先判断是代码缺陷还是建模错误：

1. 轨迹里的环境事件发生在前读之前，代码在发送时已经能看到它 → 代码缺陷。报告轨迹，不改性质、不改 `world.js` 迁就实现。
2. 环境事件只发生在 `patchIssue` 发送之后，或依赖平台不会产生的状态 → 建模错误，修 `scripts/world.js` 的注入点。
3. `unobservedRaceTraces` 非零不是失败：它数的是前读之后才发生的他人写入被本次写覆盖的轨迹。没有 CAS，Spec R8 只承诺“已观察到的不回移”。

## 4. 有意改动后更新

1. 改了 `await` 点：确认 `world.js` 仍在每个 `listCycles`、`readIssue`、`patchIssue` 进入前调用 `envStep`。新增 port 调用就为它加同样的注入点。
2. 改了性质对应的规则（Spec DD-540 变更）：先改 `verify.js` 的检查，再跑 `mutants.js` 确认新检查能失败。
3. 变体锚点失效：在 `mutants.js` 的 `MUTANTS` 中把 `from` 改成新代码里等价的那一行，保持“删掉这条守卫”的语义。
4. 两个命令都通过，并逐条对照 [references/coverage.md](references/coverage.md) 确认函数坐标仍成立，才把第 1 节和 coverage 中的 sync commit 改成新的提交。没确认就不要前移。
5. 覆盖代码已在 sync commit 之后改过却没人重查：按 `/maintain-formal-verification-skill` 把本验证拉回与代码一致。
