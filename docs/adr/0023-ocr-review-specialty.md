# OCR 作为 code-review 的专项，复用 delivery-pipeline 的 Review 模型

Status: accepted

Related: repo://docs/adr/0022-one-review-per-mmf.md；repo://skills/code-review/SKILL.md；repo://skills/code-review/scripts/ocr-native.js；上游 <https://github.com/alibaba/open-code-review>（Apache-2.0，CLI v1.14.0 实测）

## Context

alibaba/open-code-review（OCR）用确定性代码选文件、给文件分组、按文件匹配规则，再由 LLM 审查，并带定位校正与反思过滤。它的 README 承认召回率低于通用 agent，用召回换精确率。它不读 issue 或 spec，没有 Spec 轴；默认排除 Markdown。

本仓的 Review 每个 MMF 只审一轮（ADR 0022），漏掉的 P0/P1 不会再被审查者看到，所以召回优先。整体替换会丢掉 Spec 轴，取舍方向也相反。

2026-11-21 用户决定：OCR 的两种用法都接入。native 模式不另配 key，复用 delivery-pipeline 的 Review 模型。随后决定：native 成本高，只在用户点名时运行。

实测（commit 7025e1b，4 个 JS 文件）：native 走本机 Magpie 网关 `auto/gpt-6.2-sol`，产出 8 条 comment，耗时 4m49s，消耗 1,788,404 token（其中 1,471,488 为缓存读）。`ocr delegate preview` 把 10 个文件中的 6 个 Markdown 列为 excluded。

## Decision

1. OCR 是 code-review 的专项，不替换两轴，算在同一轮。覆盖清单不调模型，diff 含应用代码就跑。native 只在用户点名时运行，调用方（implement、gh-merge-pr、delivery-pipeline）不得自行开启；点名后 Standards 轴必跑，负责核实结果。何时值得一次上百万 token 的审查，由用户判断。
2. delegate 用法：`ocr delegate preview` 的 `reviewable_files` 是两个子代理的覆盖清单，每个文件要么有结论，要么写跳过理由；`ocr delegate rule` 的规则组是 Standards 子代理的额外检查点。不引入上游 `open-code-review-delegate` Skill，因为它自带一套审查流程和输出格式，会与两轴形成并行机制。
3. native 用法：`scripts/ocr-native.js` 读 `~/.config/delivery-pipeline/model-roles.json` 的 `review.whole-change.standards` 主选项，经 `~/.pi/agent/models.json` 解析 provider，翻译成 `OCR_LLM_PROTOCOL=openai`、`OCR_LLM_URL`、`OCR_LLM_TOKEN`、`OCR_LLM_MODEL`。模型只有这一个来源，OCR 不保存自己的模型配置。
4. OCR 的 comment 不是 finding。Standards 子代理逐条核实，能给出 ADR 0022 反例的才按严重度定级，否则降为 P2 或 Unknown。
5. 只用主选模型，不读 candidates，不静默降级。`ocr` 缺失为 skipped，OCR 失败为 failed，两者都写进报告，不改两轴 verdict。

## Consequences

- 用户点名的 Review 多一次 native 调用，实测一次约 5–6 分钟、143–179 万 token。普通 MMF 只多一次零模型成本的覆盖清单。
- reasoning effort 传不到模型：OCR 环境变量没有这一项。脚本只把配置的 effort 映射到 OCR 自己的 `--effort` 预设（low/medium 原样，其余取 high）。
- Review 矩阵的 agent 不是 `pi` 时脚本 failed，需要先扩展 provider 解析。
- OCR CLI 的规则随安装版本变化，报告记录 `ocrVersion`。

Backlog：跑 3–5 个有逃逸缺陷的历史 MMF，比较现有两轴、两轴 + OCR 的已知 P0/P1 召回与误报；组合没有多找回已知 P0/P1 时，重开本记录讨论移除 native 用法。
