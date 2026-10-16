import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Pi 的 import.meta.url 保留 symlink 入口，必须先定位真实文件再解析相邻核心。
const require = createRequire(realpathSync(fileURLToPath(import.meta.url)));
const { buildContext } = require("./core.cjs");

/* L3-L6 -- Pi 适配
 * INPUT: Pi tool_result 与 ctx.cwd；判定及文本归 repo://skills/test-discipline/hooks/core.cjs。
 * OUT: 追加 content 并原样保留 structuredContent；不处理子 agent 或嵌套调用。
 * PARAM: TEST_DISCIPLINE_HOOK，扩展加载时读一次；仅值 0 关闭，默认启用。
 * FAIL: 处理异常只发 test-discipline: error 通知并返回 undefined，原结果不变。
 * TEST: repo://skills/test-discipline/tests/pi.test.cjs
 * PROTOCOL: 入口或过滤合同变化时同步 repo://skills/test-discipline/SKILL.md 的 Pi 小节。
 */
export default function register(pi) {
  if (process.env.TEST_DISCIPLINE_HOOK === "0") return;
  pi.on("tool_result", (event, ctx) => {
    try {
      if (event.toolName !== "edit" && event.toolName !== "write") return;
      if (event.isError !== false || event.parentToolCallId !== undefined) return;
      if (typeof event.input?.path !== "string" || !event.input.path.trim()) {
        throw new Error("tool_result 缺少 input.path");
      }
      const text = buildContext(ctx.cwd, event.input.path);
      if (text === null) return;
      return {
        content: [...event.content, { type: "text", text }],
        ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }),
      };
    } catch (error) {
      ctx.ui.notify(`test-discipline: ${error.message}；检查事件路径与本 Skill 的写前自检小节后重试。`, "error");
      return undefined;
    }
  });
}
