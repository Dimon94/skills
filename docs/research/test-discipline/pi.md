# Pi：tool_result 追加可见性与模块解析

调查记录。对应 [#96](https://github.com/Dimon94/skills/issues/96)，验证 [#93](https://github.com/Dimon94/skills/issues/93)「Implementation Decisions」第 9 节与 Pi symlink 加载假设。只记录 Pi，不修改 spec 或 Skill。

## 结论与验收对照

| #96 验收项 | 原始观测与命令坐标 | 结论 |
| --- | --- | --- |
| edit/write 追加随机口令，模型复述 | 「追加可见性」：`pi -p --mode json -e <symlink>`；两次工具调用后的随机口令均被准确复述 | 本次主会话模型能看到追加内容 |
| 看不到时验证 steer，并回到用户确认 | 同一次运行已看到追加内容；未调用 `sendMessage` | 条件未触发；steer 替代行为为 Unknown，不改变投递方式 |
| symlink 加载的 createRequire 解析路径 | 「模块解析」：同一个 symlink 入口加载两次，裸 `createRequire(import.meta.url)` 取得 `LINK_LOCATION`；显式 realpath 后取得 `REAL_TARGET` | 裸调用按链接目录解析；不能假设自动按真实文件目录解析 |
| 原样回传 structuredContent 后正常显示 | 「结构化结果」：`structured_probe` 的后置 observer 记录 `sameReference: true`；JSON 工具执行结果保留对象，正文和追加口令正常出现 | 本次 JSON 模式正常；交互 TUI 为 Unknown |
| 推翻第 9 节时写明并回到确认 | 「对 #93 的影响」：追加方案成立；模块解析假设需澄清 | 不改 spec；将 symlink/真实路径差异交 coordinator 确认 |
| 不改用户 Pi 扩展目录 | 「隔离与验证」：`cmp global-before.json global-after.json` 退出 0 | 被快照覆盖的全局扩展目录与配置未变 |

## 环境与证据

实测于 2026-10-16，macOS。`pi --version` 输出 `1.3.0`，`node --version` 输出 `v22.22.0`。本票基线为 `82ee763493e08a3206b38a43079b8c41ae8b9847`。

- 执行目录：`/tmp/pi-issue96.4mbGDo/project`。macOS 记录的物理路径前缀为 `/private/tmp`。
- 运行读回：`provider=openai-codex`、`model=gpt-6.1-sol`、`thinking=low`、`mode=json`。
- 仓外探针：`/tmp/pi-issue96.4mbGDo/actual/probe.js`。
- 仓外原始证据根：`/tmp/pi-issue96.4mbGDo`。追加运行为 `append.events.jsonl`、`append.stdout.jsonl`、`append.stderr.txt`、`append.exit`；无追加对照为对应的 `control.*`。
- 本机一手合同：`/Users/dimon/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` 的「Tools」，以及同包 `dist/core/extensions/types.d.ts` 的 `ToolResultEventBase`、`ToolResultEventResult`。运行证据优先于文档。

临时证据不入仓，可能被系统清理。下文保留关键命令与观测，不把临时目录当作长效合同。

## 追加可见性

### 命令与探针关键片段

在临时 agent 目录使用认证与模型配置的权限受限副本；不输出凭据。用 `PI_CODING_AGENT_DIR` 重定向 Pi 的配置、缓存与状态。显式禁用其他扩展、Skill、上下文发现、MCP 和持久会话。

```sh
T=/tmp/pi-issue96.4mbGDo
cd "$T/project"
PI_CODING_AGENT_DIR="$T/agent" PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 \
PROBE_LOG="$T/append.events.jsonl" \
pi -p --mode json --no-extensions --no-mcp --no-skills \
  --no-context-files --no-prompt-templates --no-themes --no-session --offline \
  --tools write,edit,structured_probe \
  --provider openai-codex --model gpt-6.1-sol --thinking low \
  -e "$T/project/.pi/extensions/issue96.js" \
  '依次执行且不要并行：1. 用 write 创建 sample.test.txt，内容 alpha 换行。2. 用 edit 把 alpha 改成 beta。3. 调用 structured_probe。最后回答工具结果中追加的三个随机口令，格式 write=<口令> edit=<口令> structured_probe=<口令>；未见的填 Unknown。不读取其他文件，不猜口令。' \
  > "$T/append.stdout.jsonl" 2> "$T/append.stderr.txt"
```

`--offline` 关闭自动联网，不关闭显式模型请求。`--no-extensions` 仍允许显式 `-e` 加载该探针。只开放三项工具，模型无法通过 read/bash 读取探针、日志或口令。

探针在 `tool_result` 内用 `randomBytes(12).toString('hex')` 生成口令，记录原事件并返回以下形状；口令未放入 prompt、工具参数或文件内容：

```js
return {
  content: [...event.content, {
    type: 'text',
    text: `[probe:${event.toolName}] 随机口令=${nonce}。请在最终回答中原样复述。`,
  }],
  ...(event.structuredContent === undefined
    ? {} : { structuredContent: event.structuredContent }),
};
```

第二个 `tool_result` handler 观察组合后的结果；`message_end` 观察真正进入对话的 `toolResult`。二者均只写仓外日志。

### 原始观测

成功事件没有 `cwd` 字段；工作目录从 `ctx.cwd` 取得。两次原生工具事件均为 `isError: false`，没有 `parentToolCallId`，没有 `structuredContent`：

```json
{"toolName":"write","input":{"path":"sample.test.txt","content":"alpha\n"},"content":[{"type":"text","text":"Successfully wrote to sample.test.txt"}],"isError":false}
{"toolName":"edit","input":{"path":"sample.test.txt","edits":[{"oldText":"alpha","newText":"beta"}]},"content":[{"type":"text","text":"Successfully replaced 1 block(s) in sample.test.txt."}],"isError":false}
```

以上摘取事件字段；`edit` 另带 `details.diff`、`details.patch` 与 `details.firstChangedLine`。追加后原正文仍在第一块，口令在第二块。模型最终回答原文：

```text
write=76537baad03ce9b40fab8d92 edit=0c8b97fd053144db73731fc6 structured_probe=e02c2ec1ae6e1a728f41921c
```

工具输出、后置 observer、对话中的 `toolResult` 与模型回答中的口令一致。`sample.test.txt` 最终为 `beta\n`；两次工具均真正执行，不是单看进程退出码。

无追加对照使用完全相同的 prompt 与 CLI 参数，仅增加 `PROBE_APPEND=0` 并把日志和 stdout/stderr 重定向到 `control.*`。模型最终回答原文：

```text
write=Unknown edit=Unknown structured_probe=Unknown
```

结论：本次原生 edit/write 的追加内容进入后续模型请求，不是只存在于扩展日志。提醒出现在编辑完成后，不证明编辑前可见。steer 条件没有触发，未为替代方案另发模型请求。

## 模块解析

临时目录同时放置两个不同的相邻 CommonJS 模块，避免只凭路径字符串推断解析行为：

```text
actual/probe.js                         # 真实 ESM 扩展
actual/anchor.cjs                       # module.exports = 'REAL_TARGET'
project/.pi/extensions/issue96.js        # symlink -> actual/probe.js
project/.pi/extensions/anchor.cjs        # module.exports = 'LINK_LOCATION'
```

准备链接的实际命令：

```sh
ln -s /tmp/pi-issue96.4mbGDo/actual/probe.js \
  /tmp/pi-issue96.4mbGDo/project/.pi/extensions/issue96.js
```

`actual/package.json` 为 `{"type":"module"}`。两次运行均通过上节 `-e` 的 symlink 路径加载；不是向用户全局扩展目录写链接，也不是自动发现路径的验收。探针读取：

```js
const require = createRequire(import.meta.url);
const real = realpathSync(fileURLToPath(import.meta.url));
const realRequire = createRequire(real);
```

`control.events.jsonl` 中的加载记录原文：

```json
{"phase":"load","url":"file:///tmp/pi-issue96.4mbGDo/project/.pi/extensions/issue96.js","real":"/private/tmp/pi-issue96.4mbGDo/actual/probe.js","resolved":"/private/tmp/pi-issue96.4mbGDo/project/.pi/extensions/anchor.cjs","anchor":"LINK_LOCATION","realResolved":"/private/tmp/pi-issue96.4mbGDo/actual/anchor.cjs","realAnchor":"REAL_TARGET"}
```

第一次追加运行也记录 `anchor: "LINK_LOCATION"`。第二次对照运行增加显式 realpath 读回，得到 `realAnchor: "REAL_TARGET"`。

结论：在本机 Pi 加载器中，`import.meta.url` 保留链接入口，裸 `createRequire(import.meta.url)` 的相邻模块解析基于链接目录；显式 `createRequire(realpathSync(fileURLToPath(import.meta.url)))` 才取得真实目录的相邻模块。不把这个结果推广为所有 Node ESM 加载器的行为。

## 结构化结果

原生 edit/write 未带 `structuredContent`，因此另注册一个声明 `outputSchema` 的 `structured_probe`，用于覆盖真正存在该字段的路径。它不是 test-discipline 的功能实现。

工具原始返回：

```js
{
  content: [{ type: 'text', text: 'structured-visible' }],
  details: undefined,
  structuredContent: { answer: 'structured-ok', nested: { count: 7 }, items: ['a', 'b'] },
}
```

同一追加 handler 原样返回 `event.structuredContent`。后置 observer 读到的对象与工具原始对象引用相同，记录 `sameReference: true`。`append.stdout.jsonl` 的 `tool_execution_end.result` 摘录为：

```json
{"content":[{"type":"text","text":"structured-visible"},{"type":"text","text":"[probe:structured_probe] 随机口令=e02c2ec1ae6e1a728f41921c。请在最终回答中原样复述。"}],"structuredContent":{"answer":"structured-ok","nested":{"count":7},"items":["a","b"]}}
```

`tool_execution_end.isError` 为 false。对话中的 `message_end.message` 以 `role: "toolResult"` 保留上述两块正文，但没有 `structuredContent` 字段。模型准确复述了第三个口令。两次运行 stderr 均为空，进程退出 0，`agent_settled.aborted` 为 false。

结论：结构化对象在工具结果边界原样保留，正文在 JSON 输出与模型对话中正常出现；不声称结构化对象本身进入模型对话。交互 TUI 的折叠、展开和视觉显示为 Unknown，本票未运行交互模式。

## 隔离与验证

探针、目标文本、脚本与输出均在 `/tmp/pi-issue96.4mbGDo`。临时 agent 目录没有 symlink 回用户配置；认证刷新和设置写入不回写原文件。没有执行 Pi 安装命令，也没有修改 `~/.pi/agent/extensions/`。

`snapshot.py` 在运行前后记录 `~/.pi/agent/extensions/` 的目录、文件内容/权限与 symlink 目标，以及 `settings.json`、`models.json`、`mcp.json`、`keybindings.json`。快照不跟随 symlink；不据此声称链接目标的全树均未变化。检查命令：

```sh
T=/tmp/pi-issue96.4mbGDo
cmp "$T/global-before.json" "$T/global-after.json"
python3 "$T/check.py" control
python3 "$T/check.py" append
```

实际结果：`cmp` 退出 0；同一个可见性检查在无追加对照上退出 1，在追加运行上退出 0：

```text
AssertionError: 未收到三个追加口令: write=Unknown edit=Unknown structured_probe=Unknown
PASS append: 三个随机口令复述、原 content/details 保留、structuredContent 原样回传、正常结束
```

`check.py` 从事件日志读取运行时随机值，对照最终模型回答；同时检查原 content/details、结构化对象、工具执行结果、文件最终内容与正常结束。它能拒绝不追加、覆盖原正文、漏回传结构化对象或模型未复述的错误行为。不新增仓内测试设施。

## 对 #93 的影响与剩余边界

- 第 9 节的追加 `content` 与保留 `structuredContent` 方案得到本次证据支持；不触发改用 steer 的条件。
- **待 coordinator 确认**：若第 1 节 Pi ESM 复用核心、第 9 节适配实现与第 11 节 symlink 安装依赖“裸 createRequire 自动按真实路径解析”，本次观测否定该假设。建议先显式解析扩展真实路径，再创建 require；该写法已在临时探针取得 `REAL_TARGET`。spec 未明确规定裸调用，不能据此宣称整个第 9 节失效。本票不改 spec、不实施该适配层；由 coordinator 把这一澄清带回用户确认。
- 主会话、一个模型和 JSON 模式之外的行为为 Unknown。Pi 子 agent、嵌套调用、失败通知、全局自动发现、安装卸载和交互 TUI 不在本次实测结论内。
- 本次只新增调查记录，不改变运行接口、schema 或 L1–L6 合同。无构建命令或适用的文档测试套件；以真实 CLI 探针、阴性对照和 `git diff --check` 验证。`docs/deferred-hardening.md` 无新增。
