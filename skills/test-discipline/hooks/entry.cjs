const fs = require("node:fs");
const path = require("node:path");

/* L3-L6 -- Claude/Codex 事件边界
 * COORD: repo://skills/test-discipline/hooks/entry.cjs
 * IN: argv 为 claude 或 codex，stdin 为 PreToolUse 或 SubagentStart JSON；仅转换协议。
 * PARAM: claude 的 Bash 读取 tool_input.command，其余工具读取 file_path；codex 仅处理 apply_patch 的 command。
 * OUT: 两端都只输出 hookSpecificOutput，不输出 systemMessage；SubagentStart 按 cwd 注入。
 * OUT: 命中时输出 additionalContext JSON；跳过时静默退出 0，错误写 stderr 并退出 1。
 * PARAM: TEST_DISCIPLINE_HOOK 来自环境，仅值 0 关闭；关闭优先于参数和 stdin 读取。
 * CHAIN: 开关 -> 参数 -> JSON -> 事件字段校验 -> 共享核心 -> JSON 输出。
 * INVARIANT: 永不使用退出码 2，不输出权限决定，不改写调用参数，不写配置。
 * FAIL: 修正输入或恢复 SKILL.md「写前自检」小节后重试。
 * TEST: repo://skills/test-discipline/tests/hook.test.cjs
 */

function requiredString(value, field, hookEventName) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${hookEventName} 缺少 ${field}`);
  if (value.includes("\0")) throw new Error(`${hookEventName} ${field} 含 NUL 字符`);
  return value;
}

function hookInput(event, mode) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("事件必须为 JSON 对象");
  if (typeof event.hook_event_name !== "string") throw new Error("事件缺少 hook_event_name");
  const hookEventName = event.hook_event_name;
  if (!["PreToolUse", "SubagentStart"].includes(hookEventName)) return null;
  if (hookEventName === "PreToolUse") {
    const tool = requiredString(event.tool_name, "tool_name", hookEventName);
    const tools = mode === "claude" ? ["Edit", "Write", "MultiEdit", "Bash"] : ["apply_patch"];
    if (!tools.includes(tool)) return null;
  }
  const cwd = requiredString(event.cwd, "cwd", hookEventName);
  if (!path.isAbsolute(cwd)) throw new Error(`${hookEventName} cwd 必须是绝对路径`);
  if (hookEventName === "SubagentStart") return { cwd, value: null, hookEventName };
  const field = mode === "claude" && event.tool_name !== "Bash" ? "file_path" : "command";
  const value = requiredString(event.tool_input?.[field], `tool_input.${field}`, hookEventName);
  return { cwd, value, hookEventName, shell: mode === "claude" && event.tool_name === "Bash" };
}

function main() {
  if (process.env.TEST_DISCIPLINE_HOOK === "0") return;
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["claude", "codex"].includes(mode)) throw new Error("用法：entry.cjs claude|codex");
  const stdin = fs.readFileSync(0, "utf8");
  let event;
  try {
    event = JSON.parse(stdin);
  } catch (error) {
    throw new Error("stdin 不是合法 JSON", { cause: error });
  }
  const input = hookInput(event, mode);
  if (!input) return;
  const { buildContext, buildPatchContext, extractWriteTargets } = require("./core.cjs");
  const build = mode === "codex" && input.hookEventName === "PreToolUse" ? buildPatchContext : buildContext;
  const additionalContext = build(input.cwd, input.shell ? extractWriteTargets(input.value) : input.value);
  if (additionalContext === null) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hookEventName, additionalContext } }) + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`test-discipline: ${error.message}\n`);
  process.exitCode = 1;
}
