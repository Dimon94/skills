import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Pi 的 import.meta.url 保留 symlink 入口，必须先定位真实文件再解析相邻核心。
const require = createRequire(realpathSync(fileURLToPath(import.meta.url)));
const { buildContext, extractWriteTargets } = require("./core.cjs");

/* L3-L6 -- Pi 适配
 * INPUT: 主会话成功的 edit/write input.path、bash input.command、codemode input.code 与 ctx.cwd。
 * INVARIANT: 命令写入目标归共享核心 extractWriteTargets，测试文件判定与文本归 buildContext。
 * OUT: 多文件只追加一份 content 并原样保留 structuredContent；不处理子 agent 或嵌套调用。
 * PARAM: TEST_DISCIPLINE_HOOK，扩展加载时读一次；仅值 0 关闭，默认启用。
 * FAIL: 处理异常只发 test-discipline: error 通知并返回 undefined，原结果不变。
 * TEST: repo://skills/test-discipline/tests/pi.test.cjs
 * PROTOCOL: 入口或过滤合同变化时同步 repo://skills/test-discipline/SKILL.md 的 Pi 小节。
 */
export default function register(pi) {
  if (process.env.TEST_DISCIPLINE_HOOK === "0") return;
  pi.on("tool_result", (event, ctx) => {
    try {
      const fields = { edit: "path", write: "path", bash: "command", codemode: "code" };
      if (!Object.hasOwn(fields, event.toolName)) return;
      if (event.isError !== false || event.parentToolCallId !== undefined) return;
      const field = fields[event.toolName];
      const value = event.input?.[field];
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`tool_result 缺少 input.${field}`);
      }
      const text = buildContext(ctx.cwd, field === "path" ? value : extractWriteTargets(value, field === "code" ? "codemode" : "shell"));
      if (text === null) return;
      return {
        content: [...event.content, { type: "text", text }],
        ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }),
      };
    } catch (error) {
      ctx.ui.notify(`test-discipline: ${error.message}；检查事件输入与本 Skill 的写前自检小节后重试。`, "error");
      return undefined;
    }
  });
}
