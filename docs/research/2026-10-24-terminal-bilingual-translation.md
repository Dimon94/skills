# 终端 agent 的中英双向翻译：现成轮子调查

职责：为两个需求找现成方案，避免重造轮子。本文是调查记录，不是已实施合同。检索日期：2026-10-24。未安装任何工具，未改任何配置。

- 功能 1（输入 zh→en）：微信输入法语音转出的中文，在发给 Claude Code / Pi 之前变成忠实的英文。最好能参考近期对话和项目术语。
- 功能 2（阅读 en→zh）：agent 的英文回复在同一终端内显示中文，最好像沉浸式翻译那样逐段对照。

结论：两个宿主都已有现成插件，且都走宿主官方钩子。Claude Code 用 `cctrans`（MIT）可同时覆盖两项，但输入侧只能“附加译文”，不能替换原文。Pi 用 `@pithos-kit/translate`（MIT）可真正替换输入；输出侧是整段替换为译文，不是逐段对照。往别人的全屏 TUI 内部插行，只能经宿主钩子做；外部进程做不到。剩余缺口是：输入翻译不带对话上下文；cctrans 不直连 DeepSeek / Ollama；Pi 侧缺逐段对照显示。

## 宿主集成点（一手证据）

### Claude Code

| 能力 | 结论 | 证据 |
|---|---|---|
| `UserPromptSubmit` 改写 prompt | 不能。只能 `decision: "block"` 或注入 `additionalContext` | 官方原文：“`UserPromptSubmit`: can't replace the prompt; it only injects `additionalContext` alongside it”。[Hooks reference](https://code.claude.com/docs/en/hooks) |
| 改写屏幕上的助手回复 | 能，`MessageDisplay` 钩子返回 `displayContent` 替换显示 | 官方原文：“`displayContent` replaces the displayed text on screen. Display-only: the transcript and what Claude sees keep the original”。按已完成行分批调用，默认超时 10 秒，失败回落原文。[Hooks reference#MessageDisplay](https://code.claude.com/docs/en/hooks) |
| `MessageDisplay` 的覆盖范围 | 只收助手文本；工具结果和用户输入原样显示 | 同上：“The hook receives assistant message text only, so tool results and the text you type render unchanged.” |
| Output style 实现双语 | 可以写指令让 Claude 双语回复，但不保证执行，且双语输出计入 token | 官方原文：“It's an instruction Claude follows, so nothing enforces it.”；“Token usage depends on the style.” [Output styles](https://code.claude.com/docs/en/output-styles) |
| Statusline 承载译文 | 本次未核对 statusline 文档：Unknown。推断：状态栏只适合短文本，装不下逐段译文 | — |

推断：Claude Code 里，功能 2 的正路是 `MessageDisplay`。功能 1 只能“原文 + 英文附加上下文”，原中文仍进入 transcript 和模型上下文。

### Pi（本机 `@earendil-works/pi-coding-agent` 1.4.0）

| 能力 | 结论 | 证据 |
|---|---|---|
| 发送前变换用户输入 | 能。`input` 事件返回 `{ action: "transform", text }` | 意图表“Inspect, transform, or consume raw user input → `input`”：[docs/extensions.md:151](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:151)；结果类型：[dist/core/extensions/types.d.ts:921-929](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:921)；示例：[examples/extensions/input-transform.ts:22-28](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/input-transform.ts:22) |
| 输入事件区分来源与 steer | 能。`source` 为 `interactive/rpc/extension`；`streamingBehavior` 为 `steer/followUp` | [types.d.ts:907-919](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:907)；[input-transform-streaming.ts:19-23](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/input-transform-streaming.ts:19) |
| 改写助手 Markdown 的显示 | 能。`registerMarkdownTransformer` 在渲染前变换用户与助手 Markdown | [types.d.ts:1251-1252](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:1251)。上游类型为 `(markdown, context) => string`，即同步返回：[types.ts（main）](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts) |
| 插入不进上下文的卡片 | 能。`appendEntry` + `registerEntryRenderer` | [docs/extensions.md:344](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:344)；[examples/extensions/entry-renderer.ts:20-38](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/entry-renderer.ts:20) |
| 自定义消息渲染 | 能。`registerMessageRenderer` | [types.d.ts:1250](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:1250)；[examples/extensions/message-renderer.ts:15](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/message-renderer.ts:15) |
| Widget / overlay | 能。`setWidget`（编辑器上/下方）；`ctx.ui.custom(..., { overlay: true })` | [examples/extensions/widget-placement.ts:6-7](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/widget-placement.ts:6)；[docs/tui.md](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md)“Use custom screens and overlays”节 |
| 替换已完成消息 | 能，但会改上下文。`message_end` 可替换消息，须保持 role | [docs/extensions.md:218](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:218) |
| 嵌套模型调用 | `ctx.modelRegistry.streamSimple()` | [docs/extensions.md:327](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:327) |

推断：Pi 的接口比 Claude Code 完整。输入可真替换，输出可在显示层追加译文。Markdown transformer 是同步的，异步翻译要靠缓存加重绘。

### herdr（侧窗方案用）

本次运行没有可执行 shell 的工具，未能运行 `herdr pane --help` 等命令；本机 herdr 版本与本地 help 输出：Unknown。以下取自官方文档，需按本机版本复核。

- 读取其他 pane：`herdr pane read <pane_id> [--source visible|recent|recent-unwrapped|detection] [--lines N] [--format text|ansi]`；默认去掉 ANSI。[CLI reference](https://herdr.dev/docs/cli-reference/)
- 开侧窗：`herdr pane split [<pane_id>|--current] --direction right|down [--ratio FLOAT] [--no-focus]`，返回 `.result.pane.pane_id`。同上。
- 等待输出：`herdr pane wait-output <pane_id> (--match|--regex) ...`；面向 agent 用 `herdr agent wait`。同上。
- 事件流：socket API 有 `events.subscribe`，pane 事件包括 `pane.output_matched`、`pane.agent_status_changed`；还有 `plugin.pane.open`。[Socket API](https://herdr.dev/docs/socket-api/)

推断：可以在 agent 进入 idle 后读最近输出、翻译，写入右侧 pane。它拿到的是渲染后的屏幕文本，含 TUI 边框和折行，不是结构化消息。

## 功能 1：输入 zh→en

### 输入法自带翻译

| 方案 | 结论 | 证据 |
|---|---|---|
| 微信输入法（Mac） | Mac 版是否有输入时翻译或语音直译：Unknown。官方站点为 JS 渲染，未取到正文。iOS App Store 页只列语音转文字、问 AI 等，没有翻译条目 | [App Store 微信输入法页](https://apps.apple.com/cn/app/%E5%BE%AE%E4%BF%A1%E8%BE%93%E5%85%A5%E6%B3%95/id1618175312) |
| 微信（聊天 App，非输入法）4.1.10 | 有“边写边译”，入口在微信聊天输入框右键菜单；仅限微信内 | IT之家报道（二手）：[微信 Win/Mac 4.1.10](https://www.ithome.com/0/956/252.htm) |
| 搜狗输入法 Mac | 官方页 JS 渲染，未核实：Unknown | — |
| 讯飞输入法 Mac“随声译” | 仅媒体报道，未找到官方说明：Unknown | — |
| macOS 系统翻译 | 选中文本 → 右键“翻译” →“使用译文替换”；可下载语言离线翻译 | [Apple 支持：在 Mac 上翻译文本](https://support.apple.com/zh-cn/guide/mac-help/mchldd8b3c15/mac) |

推断：即使输入法能翻，也只做句级直译，不带项目上下文。

### macOS 通用翻译工具

| 方案 | 原地替换 | 自定义 prompt | 引擎 | 许可/价格 | 维护 | 证据 |
|---|---|---|---|---|---|---|
| Bob | 是：“静默输入框翻译”翻译输入框全部内容并替换；“静默划词翻译”替换选区；均无默认快捷键 | 插件可自定义 API；内置服务的 prompt 可否改：Unknown | Ollama、DeepSeek、OpenAI、通义、豆包、混元等；可写 JS 插件 | 闭源；Pro 买断，价格以 App Store 为准（检索摘要称 ¥58，未直接核对） | 活跃（官网列 deepseek-flash 定价，说明近期更新） | [Bob 翻译](https://bobtranslate.com/guide/quickstart/translate.html)；[Bob 服务列表](https://bobtranslate.com/guide/advance/service.html) |
| Easydict | 是：“translate-and-replace”“polish-and-replace”快捷键，需辅助功能权限 | 可加多个“custom OpenAI-compatible services”；prompt 定制：Unknown | DeepSeek、Ollama、OpenAI、Claude Code、Codex CLI 等 20+ | GPL-3.0，免费 | 活跃：2.24.0 发布于 2026-09-27，2026-10-24 仍有推送 | [README](https://github.com/tisfeng/Easydict)；[GUIDE.md](https://github.com/tisfeng/Easydict/blob/dev/docs/user-docs/en/GUIDE.md)；[GitHub API](https://api.github.com/repos/tisfeng/Easydict) |
| Raycast AI Command | 是：Output Behavior =“Replace Selection” | 是：prompt 可含 `{selection}` 等占位符 | 每条命令可选模型；同页提到 AI Commands 可用自有订阅、API key 或本地模型 | 商业；Quick Fix 固定走 Raycast AI 积分 | 活跃 | [Raycast AI Commands](https://manual.raycast.com/ai/ai-commands) |
| pot-desktop | 未见原地替换说明：Unknown | 插件系统 | OpenAI、Ollama 等 | GPL-3.0 | **已归档**（GitHub `archived: true`）；最后发布 3.0.7（2025-05-10） | [README](https://github.com/pot-app/pot-desktop)；[GitHub API](https://api.github.com/repos/pot-app/pot-desktop) |
| OpenAI Translator（现 nextai-translator） | 未核实：Unknown | Unknown | Unknown | AGPL-3.0 | 活跃：v0.6.45（2026-10-24） | [GitHub API](https://api.github.com/repos/openai-translator/openai-translator) |
| PopClip 扩展 | 未调查：Unknown | — | — | — | — | — |

关键限制（推断，需实测）：这些工具靠 macOS 辅助功能读写“原生文本框”。Claude Code 和 Pi 的输入框由 TUI 在终端里绘制，不是原生文本框。所以“静默输入框翻译 / Quick Fix”在终端里多半读不到输入框。“选中后替换”在终端里也只是粘贴文本，可能被 TUI 当作 paste 处理。

### Shell 可用的 CLI 翻译器

| 方案 | 能力 | 许可 | 证据 |
|---|---|---|---|
| translate-shell | Google / Bing / Apertium；无 LLM、无上下文 | Unlicense（检索摘要，未直接打开 README） | [README](https://github.com/soimort/translate-shell/blob/develop/README.md) |
| simonw `llm` | 任意 prompt / system prompt；`llm-ollama` 插件接 Ollama | Apache-2.0 | [README](https://github.com/simonw/llm) |
| aichat | 20+ 提供方，含 DeepSeek、Ollama、任意 OpenAI 兼容；role = prompt + 模型 | MIT 或 Apache-2.0 | [README](https://github.com/sigoden/aichat) |

推断：CLI 适合做翻译后端，不能单独解决“进 agent 输入框之前”的拦截问题。

### 宿主插件（最接近需求）

| 方案 | 宿主 | 输入翻译方式 | 上下文 | 引擎 | 许可/维护 | 证据 |
|---|---|---|---|---|---|---|
| cctrans 0.5.4 | Claude Code | `UserPromptSubmit` 把英文译文作为 `additionalContext` 附加，并声明“treat it as the canonical instruction”；原文不删；beta；非拉丁字符 ≥4 才触发；超时 8–9 秒放行 | 不带对话上下文 | openai、anthropic、deepl、azure、google（免费）、claude-code（`claude -p` 调 haiku，约 3 秒） | MIT；11 star；最后推送 2026-06-11 | [README](https://github.com/roy-jiang-opus/cctrans)；[hook/user-prompt-submit.js](https://github.com/roy-jiang-opus/cctrans/blob/main/hook/user-prompt-submit.js)；[src/backends/index.js](https://github.com/roy-jiang-opus/cctrans/blob/main/src/backends/index.js) |
| AndrewK404/translate-hooks | Claude Code / Codex | 同样是 `UserPromptSubmit` 附加上下文（检索摘要） | Unknown | Unknown | MIT；4 star；最后推送 2026-05-21 | [GitHub API](https://api.github.com/repos/AndrewK404/translate-hooks) |
| @pithos-kit/translate 3.1.0 | Pi ≥1.0.0 | `input` 事件真替换；原文不入主模型上下文；保护代码块、行内代码、URL；skill/模板指令只译参数；失败 fail-closed 并恢复草稿；可选英文预检 | README 未提对话上下文 | Pi 已认证的任意 `provider/model`，无回退 | MIT；npm 有 SLSA provenance | [Pi 包页](https://pi.dev/packages/%40pithos-kit/translate)；[npm](https://registry.npmjs.org/@pithos-kit/translate/latest) |
| pi-prompt-translate 1.0.3 | Pi | `input` 事件替换；失败时放行原文 | 无 | 当前模型或指定模型 | MIT | [Pi 包页](https://pi.dev/packages/pi-prompt-translate) |
| pi-lingo 1.0.5 | Pi | 把输入改成“给出三种译文”的请求，不是发送前翻译 | — | Pi 模型 | MIT | [Pi 包页](https://pi.dev/packages/pi-lingo) |

注意：cctrans 的 openai 后端把地址写死为 `https://api.openai.com/v1/chat/completions`。不改代码就不能指向 DeepSeek 或 Ollama 的 OpenAI 兼容接口。[src/backends/openai.js](https://github.com/roy-jiang-opus/cctrans/blob/main/src/backends/openai.js)

Pi 能否把 DeepSeek / Ollama 注册成 pithos 可选的 `provider/model`：未核实，Unknown。推断：Pi 有 `pi.registerProvider()`（[docs/extensions.md:182](/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:182)），大概率可行。

### 功能 1 适配矩阵

| 方案 | 覆盖了什么 | 缺口 | 成本/许可 | 证据 |
|---|---|---|---|---|
| Pi + @pithos-kit/translate | 发送前真替换；代码/URL 保护；fail-closed；skill 指令保留 | 无对话/术语上下文；steer 与 follow-up 被阻断；DeepSeek/Ollama 接入待验证 | MIT；按所选模型计费 | [包页](https://pi.dev/packages/%40pithos-kit/translate) |
| Claude Code + cctrans `input on` | 自动附加英文译文；失败放行 | 原文不能删，中文仍占上下文 token；无上下文；不直连 DeepSeek/Ollama；beta | MIT；需 OpenAI/Anthropic/DeepL key 或用 `claude -p` | [hook 源码](https://github.com/roy-jiang-opus/cctrans/blob/main/hook/user-prompt-submit.js) |
| Raycast AI Command（Replace Selection） | 任意 app 选区替换；prompt 可定制，可写术语表 | 终端 TUI 输入框能否选中并替换未验证；需手动触发；商业 | 商业订阅/自有 key | [Raycast](https://manual.raycast.com/ai/ai-commands) |
| Easydict translate-and-replace | 免费；DeepSeek/Ollama/自定义 OpenAI 兼容 | 同上，终端可用性未验证；prompt 定制 Unknown | GPL-3.0 免费 | [GUIDE.md](https://github.com/tisfeng/Easydict/blob/dev/docs/user-docs/en/GUIDE.md) |
| Bob 静默输入框翻译 | 一键翻译并替换输入框全部内容 | 依赖原生输入框，终端 TUI 多半不适用（推断） | Pro 买断 | [Bob 翻译](https://bobtranslate.com/guide/quickstart/translate.html) |
| 输入法自带翻译 | — | Mac 版能力 Unknown；无上下文 | 免费 | 见上表 |

## 功能 2：阅读 en→zh

### 能否往别人的全屏 TUI 里插译文行

不能从外部插入。原因（推断，基于终端模型）：Claude Code、Pi 自己维护屏幕状态，按差量重绘。外部进程往同一 pty 写字节，会被下次重绘覆盖，或打乱光标位置。可行路径只有三条：

1. 宿主钩子改显示：Claude Code `MessageDisplay`；Pi `registerMarkdownTransformer` 或 entry renderer。
2. 旁路显示：herdr / tmux 侧窗，读屏后翻译。
3. 让模型自己双语输出：output style / system prompt。不受保证，还增加 token。

### 候选方案

| 方案 | 结论 | 证据 |
|---|---|---|
| cctrans（Claude Code） | 基于 `MessageDisplay`；逐行在英文下插一行中文；也有按块、整条、仅译文模式；transcript 与上下文保持英文；代码块和路径跳过；出错回落英文 | [README](https://github.com/roy-jiang-opus/cctrans) |
| @pithos-kit/translate 输出模式（Pi） | 仅显示层；流式时隐藏英文，完成后整块换成译文并标注“Translated”；只译无工具调用的最终文本；另有 `/translate` 手动生成不进上下文的译文卡片 | [Pi 包页](https://pi.dev/packages/%40pithos-kit/translate) |
| Immersive Translate | 浏览器扩展与移动浏览器；官方文档未提桌面终端支持 | [Immersive Translate 文档](https://immersivetranslate.com/docs/) |
| iTerm2 | Python API 可读会话内容；需自写脚本，未见现成翻译插件 | 检索摘要指向 [iTerm2 Python API](https://iterm2.com/python-api/)，未逐页核对 |
| tmux | 未找到专用翻译插件；`tmux-llm` 可把 pane 内容发给 OpenAI 兼容 LLM 并弹窗（二手摘要，未核对仓库） | — |
| Warp、Ghostty | 本次未调查：Unknown | — |
| 截图 OCR 翻译（Bob、Easydict、pot） | Bob 截图翻译默认 `⌥S`；Easydict `Option+S`；pot 截图翻译。弹窗显示，不在终端内对照 | [Bob 翻译](https://bobtranslate.com/guide/quickstart/translate.html)；[Easydict GUIDE](https://github.com/tisfeng/Easydict/blob/dev/docs/user-docs/en/GUIDE.md) |
| Output style 要求双语 | 零工具；但官方说明不强制，且双语全部计入输出 token | [Output styles](https://code.claude.com/docs/en/output-styles) |

### 功能 2 适配矩阵

| 方案 | 覆盖了什么 | 缺口 | 成本/许可 | 证据 |
|---|---|---|---|---|
| Claude Code + cctrans | 同终端、同会话、逐行对照，最接近沉浸式翻译；不耗主会话 token | 不直连 DeepSeek/Ollama；工具输出不翻；每批受 10 秒超时约束 | MIT；免费 Google 或付费后端 | [README](https://github.com/roy-jiang-opus/cctrans)；[Hooks](https://code.claude.com/docs/en/hooks) |
| Pi + @pithos-kit/translate | 同终端显示层翻译；不改上下文；可手动出卡片 | 替换而非对照；流式期间看不到英文；工具调用消息不翻 | MIT；按所选模型计费 | [包页](https://pi.dev/packages/%40pithos-kit/translate) |
| herdr 侧窗 + `pane read` + CLI 翻译 | 宿主无关；两个 agent 通用 | 拿到的是屏幕文本，含边框/折行；需自写轮询或订阅脚本；左右对照不是逐段交错 | 免费 | [herdr CLI](https://herdr.dev/docs/cli-reference/) |
| 截图 OCR 翻译 | 零集成，随时可用 | 手动、弹窗、不在终端内 | Bob 买断 / Easydict 免费 | 见上 |
| Output style / system prompt 双语 | 零工具 | 不保证；token 翻倍；污染上下文 | 主模型 token | [Output styles](https://code.claude.com/docs/en/output-styles) |

## 引擎

### DeepSeek API（官方定价页）

- 模型名：`deepseek-flash`（DeepSeek-V4.1-Flash-1017）与 `deepseek-v4-pro`。旧名 `deepseek-v4-flash` 仍接受，按 Flash 计价。OpenAI 格式 base URL `https://api.deepseek.com`；也有 Anthropic 格式 `https://api.deepseek.com/anthropic`。[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- 价格（每 1M token，`deepseek-flash`）：输入未命中缓存 off-peak $0.15 / peak $0.3；输出 off-peak $0.6 / peak $1.2。Peak 为工作日 UTC 01:00–04:00 与 06:00–10:00。同上。
- 思考模式默认开启，可切非思考。同上。推断：翻译应关思考，以降延迟。
- 延迟：官方页未给数字，Unknown。

### 本地模型（48 GB Apple silicon）

| 模型 | 存在性 | 许可 | 备注 | 证据 |
|---|---|---|---|---|
| `qwen3:8b/14b/30b/32b` | Ollama 官方库：5.2 / 9.3 / 19 / 20 GB | Apache-2.0（Ollama license blob） | 通用模型，可用 prompt 注入上下文与术语 | [ollama.com/library/qwen3](https://ollama.com/library/qwen3) |
| `translategemma:4b/12b/27b` | Ollama 官方库：3.3 / 8.1 / 17 GB，128K 上下文 | Gemma 条款，未核对：Unknown | 有固定 prompt 格式，含 zh-Hans→en 示例 | [ollama.com/library/translategemma](https://ollama.com/library/translategemma) |
| Hunyuan-MT-7B | Hugging Face 有；Ollama 官方库 404，只有社区上传（如 `huihui_ai/hunyuan-mt-abliterated`） | `tencent-hunyuan-community`；检索摘要称地域排除欧盟、英国、韩国，未直接读许可全文 | 2025-09-01 开源 | [HF](https://huggingface.co/tencent/Hunyuan-MT-7B)；[Ollama 搜索](https://ollama.com/search?q=hunyuan) |
| HY-MT1.5-1.8B / 7B | HF 有；Ollama 仅社区上传 | HF 元数据未标许可，仓库含 License.txt：Unknown | 官方给出“上下文翻译”“术语干预”prompt 模板，最贴合功能 1 | [HF HY-MT1.5-7B](https://huggingface.co/tencent/HY-MT1.5-7B) |
| Hy-MT2-1.8B / 7B / 30B-A3B | HF 有，含官方 GGUF | 7B 为 Apache-2.0 | GGUF 依赖 llama.cpp PR #22836 的 STQ kernel；Ollama 能否加载：Unknown | [HF Hy-MT2-7B API](https://huggingface.co/api/models/tencent/Hy-MT2-7B)；[Hy-MT2-7B-GGUF](https://huggingface.co/tencent/Hy-MT2-7B-GGUF) |
| Seed-X-PPO-7B | HF 有；未见 Ollama 官方条目 | OpenMDW | 28 种语言，含 zh/en；Mistral 架构 | [HF](https://huggingface.co/ByteDance-Seed/Seed-X-PPO-7B) |

本机现状（任务给定）：只拉取了 codellama 与 qwen3-embedding:0.6b，均不适合翻译。

## 最小拼装路径

### 功能 1

1. **Pi**：装 `@pithos-kit/translate`，开 `input-on`，选一个快模型。现成覆盖“发送前真替换”。
   - 剩余缺口：译文不带对话上下文和术语表；DeepSeek / Ollama 能否作为 Pi provider 被选中，需验证。
   - 自写最小代码：一个 Pi 扩展的 `input` handler，翻译前从 `ctx.sessionManager` 取最近几条消息，再加项目术语表，套 HY-MT1.5 的“上下文翻译”模板或 DeepSeek system prompt。约等于 pithos 的输入半边加上下文拼接。
2. **Claude Code**：装 `cctrans` 并开 `input on`。现成覆盖“自动附加英文”。
   - 剩余缺口（宿主硬限制）：原中文无法从 prompt 中移除。要真替换，只能在提交前改文本，即宿主外方案（Raycast / Easydict 选区替换），而它们对终端 TUI 输入框的可用性未验证。
   - 自写最小代码：给 cctrans 的 openai 后端加可配置 base URL 和模型名，指向 `https://api.deepseek.com` 或 Ollama `http://localhost:11434/v1`。上下文可从 hook stdin 的 `transcript_path` 读取。

### 功能 2

1. **Claude Code**：`cctrans` 逐行模式，零自写代码即可达到“同终端逐段对照”。只缺 DeepSeek / Ollama 后端，补法同上。
2. **Pi**：`@pithos-kit/translate` 输出模式能用，但是替换不是对照。
   - 自写最小代码：一个 `registerMarkdownTransformer`，返回“原段 + 译段”。transformer 是同步的，所以要在 `message_end` 或 `turn_end` 异步翻译、写缓存，再触发重绘。译文持久化可用 `appendEntry`，不进上下文。重绘触发方式：Unknown，需读 Pi 源码确认。
3. **宿主无关兜底**：herdr `pane split --direction right --no-focus` 开侧窗，`agent wait` 后 `pane read --source recent-unwrapped`，管道给 `llm` / `aichat` 翻译后输出。需要一个小脚本，并处理边框和折行噪声。

## 来源与证据限制

- 一手：[Claude Code Hooks](https://code.claude.com/docs/en/hooks)、[Output styles](https://code.claude.com/docs/en/output-styles)、本机 Pi 1.4.0 文档与类型声明、[herdr CLI](https://herdr.dev/docs/cli-reference/) 与 [Socket API](https://herdr.dev/docs/socket-api/)、[DeepSeek 定价](https://api-docs.deepseek.com/quick_start/pricing)、Bob / Easydict / Raycast / Apple 官方文档、各 GitHub 与 npm 元数据、Hugging Face 模型卡与 API。
- 插件行为取自其 README 与源码，未实际运行。
- 二手（已标注）：微信“边写边译”（IT之家）；translate-shell 许可、Hunyuan-MT 地域条款、Bob 价格、tmux-llm（检索摘要）。
- 未能执行：本机 `herdr ... --help`（本次无 shell 工具）；Bob / Easydict / Raycast 在终端 TUI 输入框里的替换能力；各本地模型的延迟与质量；DeepSeek 实测延迟。
