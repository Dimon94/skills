# TS/JS 语言节模板

建档时为每个命中 `package.json` 的目录填写一节。下方占位符必须替换为证据或 Unknown；只将填写后的语言节追加到通用正文。

- 命令读取该目录 `package.json` 的 `scripts.test` 及 CI 测试步骤，沿用已有包管理器与执行方式。不把 `echo "Error: no test specified"` 等占位脚本当作测试命令；没有真实条目时写 Unknown。
- 命名沿用该目录现有测试文件，没有现例时用 `*.test.ts`。
- 隔离手段只选项目已有框架自带的 fake timers 与 mock；未安装框架时不填其能力。Node.js 临时目录使用 `fs.mkdtemp`，浏览器专属环境不假定能用 Node.js API。

---

### TS/JS — <仓内目录，根目录写 .>

- 执行目录：<仓内目录>
- 测试命令：<真实命令或 Unknown>
- 命令来源：<repo://文件 + scripts.test 或 CI 测试步骤行号；无则 Unknown>
- 命名约定：<现有命名及示例路径；无现例为 *.test.ts>
- 隔离手段：<已安装框架及其 fake timers/mock、可用的 fs.mkdtemp；无证据项为 Unknown>
