const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skill = path.resolve(__dirname, "..");
const extension = path.join(skill, "hooks/pi.js");
const CHECKLIST = "哪个具体错误实现会让哪条断言失败";
const original = [{ type: "text", text: "原工具结果" }, { type: "image", data: "AA==", mimeType: "image/png" }];
const runner = `
  import { pathToFileURL } from "node:url";
  const { default: register } = await import(pathToFileURL(process.env.TEST_EXTENSION));
  const handlers = {};
  register({ on(name, callback) {
    if (!["tool_result", "session_compact", "session_tree"].includes(name)) throw new Error("错误的事件订阅");
    handlers[name] = callback;
  } });
  const handler = handlers.tool_result;
  if (process.env.NEXT_SWITCH) process.env.TEST_DISCIPLINE_HOOK = process.env.NEXT_SWITCH;
  const event = JSON.parse(process.env.TEST_EVENT);
  const before = JSON.stringify(event);
  const notifications = [];
  const ctx = {
    cwd: process.env.TEST_CWD,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  };
  if (Array.isArray(event)) {
    // 序列内 type 字段表示会话事件，其余按 tool_result 依次投递给同一运行时。
    const results = [];
    for (const step of event) {
      if (step.type) await handlers[step.type]?.(step, ctx);
      else results.push((await handler?.(step, ctx)) ?? null);
    }
    console.log(JSON.stringify({ results, notifications }));
    process.exit(0);
  }
  const result = await handler?.(event, ctx);
  console.log(JSON.stringify({
    result: result ?? null, notifications, unchanged: before === JSON.stringify(event),
    sameStructured: result?.structuredContent === event.structuredContent,
  }));
`;

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-discipline-"));
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "测试规范：repo://TESTING.md\n");
  fs.writeFileSync(path.join(root, "TESTING.md"), "项目规范正文不应注入\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function invoke(cwd, changes = {}, env = {}) {
  const environment = {
    ...process.env, HOME: cwd, CLAUDE_SETTINGS: path.join(cwd, "claude/settings.json"),
    CODEX_HOOKS: path.join(cwd, "codex/hooks.json"), PI_EXTENSIONS_DIR: path.join(cwd, "pi/extensions"),
    TEST_DISCIPLINE_HOOK: "1", TEST_EXTENSION: extension, TEST_CWD: cwd,
    TEST_EVENT: JSON.stringify({ toolName: "write", isError: false, input: { path: "a.test.js" }, content: original, ...changes }),
    ...env,
  };
  delete environment.FORCE_COLOR;
  delete environment.COLORTERM;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", runner], {
    encoding: "utf8", env: environment, timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("缝 2 #1：write 测试文件保留原 content 与 structuredContent，追加共享自检", (t) => {
  const output = invoke(sandbox(t), { structuredContent: { answer: 7, nested: ["a"] } });
  assert.deepEqual(output.result.content.slice(0, -1), original);
  const appended = output.result.content.at(-1);
  assert.equal(appended.type, "text");
  assert.match(appended.text, /^\[test-discipline\] 命中测试文件：a\.test\.js\n/);
  assert.ok(appended.text.includes(CHECKLIST));
  assert.ok(appended.text.includes("项目测试规范（来源：测试规范索引）：\n- TESTING.md\n最近 AGENTS.md：AGENTS.md\n"));
  assert.ok(!appended.text.includes("项目规范正文不应注入"));
  assert.deepEqual(output.result.structuredContent, { answer: 7, nested: ["a"] });
  assert.equal(output.sameStructured, true);
  assert.equal(output.unchanged, true);
  assert.deepEqual(output.notifications, []);
});

for (const [name, toolName, input, files] of [
  ["Bash heredoc", "bash", { command: "cat > tests/a.js <<'EOF'\n正文\nEOF" }, "tests/a.js"],
  ["codemode tools.bash printf 转义", "codemode", { code: String.raw`await tools.bash({command: "printf '%s\\n' x > tests/a.js"});` }, "tests/a.js"],
  ["codemode tools.bash 空格转义", "codemode", { code: String.raw`await tools.bash({command: "echo a\\ b > tests/a.js"});` }, "tests/a.js"],
  ["codemode tools.write/edit", "codemode", { code: 'await tools.write({path: "tests/a.js", content: "x"}); await tools.edit({path: "load/run.js", edits: []}); await tools.write({path: "tests/a.js", content: "y"});' }, "tests/a.js、load/run.js"],
  ["codemode tools.bash", "codemode", { code: `await tools.bash({timeout: 10, command: "cat > 'tests/shell case.js' <<'EOF'\\nx\\nEOF"}); await tools.write({path: "load/run.js", content: "x"});` }, "tests/shell case.js、load/run.js"],
]) {
  test(`缝 2 ${name}：只追加一份提醒并保留原结果`, (t) => {
    const output = invoke(sandbox(t), { toolName, input, structuredContent: { answer: 7 } });
    assert.ok(output.result, toolName);
    assert.equal(output.result.content.length, original.length + 1);
    assert.deepEqual(output.result.content.slice(0, -1), original);
    const reminder = output.result.content.at(-1);
    assert.equal(reminder.type, "text");
    assert.equal(reminder.text.split("\n")[0], `[test-discipline] 命中测试文件：${files}`);
    assert.ok(reminder.text.includes(CHECKLIST));
    assert.ok(reminder.text.includes("项目测试规范（来源：测试规范索引）：\n- TESTING.md\n"));
    assert.equal(output.sameStructured, true);
    assert.deepEqual(output.result.structuredContent, { answer: 7 });
    assert.equal(output.unchanged, true);
    assert.deepEqual(output.notifications, []);
  });
}

test("缝 2 #5：同一运行时每个测试文件首次成功写入才提醒，压缩或切树后重新提醒", (t) => {
  const write = (file, changes = {}) => ({ toolName: "write", isError: false, input: { path: file }, content: original, ...changes });
  const { results, notifications } = invoke(sandbox(t), { toolName: "write" }, {
    TEST_EVENT: JSON.stringify([
      write("c.test.js", { isError: true }), write("c.test.js"),
      write("a.test.js"), write("./a.test.js"),
      { ...write("x"), toolName: "bash", input: { command: "echo x > a.test.js; echo y > b.test.js" } },
      { type: "session_compact" }, write("a.test.js"),
      { type: "session_tree" }, write("a.test.js"),
    ]),
  });
  const headings = results.map((result) => result?.content.at(-1).text.split("\n")[0] ?? null);
  assert.deepEqual(headings, [
    null, "[test-discipline] 命中测试文件：c.test.js",
    "[test-discipline] 命中测试文件：a.test.js", null,
    "[test-discipline] 命中测试文件：b.test.js",
    "[test-discipline] 命中测试文件：a.test.js",
    "[test-discipline] 命中测试文件：a.test.js",
  ]);
  assert.deepEqual(notifications, []);
});

test("Pi 关闭开关只在扩展加载时读取，启用的 edit 同样追加", (t) => {
  const cwd = sandbox(t);
  const enabled = invoke(cwd, { toolName: "edit" }, { NEXT_SWITCH: "0" });
  assert.equal(enabled.result.content.length, original.length + 1);
  assert.deepEqual(enabled.result.content.slice(0, -1), original);
  assert.ok(!Object.hasOwn(enabled.result, "structuredContent"));
  const disabled = invoke(cwd, {}, { TEST_DISCIPLINE_HOOK: "0", NEXT_SWITCH: "1" });
  assert.equal(disabled.result, null);
  assert.deepEqual(disabled.notifications, []);
});

test("缝 2 #4：SKILL.md 不可读时只通知 error，不抛错或改结果", (t) => {
  const cwd = sandbox(t);
  const copy = path.join(cwd, "isolated-skill");
  fs.cpSync(path.join(skill, "hooks"), path.join(copy, "hooks"), { recursive: true });
  const output = invoke(cwd, {}, { TEST_EXTENSION: path.join(copy, "hooks/pi.js") });
  assert.equal(output.result, null);
  assert.equal(output.unchanged, true);
  assert.equal(output.notifications.length, 1);
  assert.equal(output.notifications[0].level, "error");
  assert.match(output.notifications[0].message, /^test-discipline: .*SKILL\.md.*ENOENT/);
});

test("缝 2 #3：失败或嵌套工具结果保持不变", (t) => {
  const cwd = sandbox(t);
  for (const [toolName, input] of [
    ["write", { path: "a.test.js" }],
    ["bash", { command: "echo x > tests/a.js" }],
    ["codemode", { code: 'await tools.write({path: "tests/a.js", content: "x"})' }],
  ]) {
    for (const changes of [{ isError: true }, { isError: undefined }, { parentToolCallId: "parent" }]) {
      const output = invoke(cwd, { toolName, input, ...changes });
      assert.equal(output.result, null);
      assert.equal(output.unchanged, true);
      assert.deepEqual(output.notifications, []);
    }
  }
});

test("缝 2 #2：普通源码、只读命令与跑测试不追加", (t) => {
  const cwd = sandbox(t);
  for (const changes of [
    { toolName: "edit", input: { path: "src/app.ts" } },
    { toolName: "read" },
    { toolName: "bash", input: { command: "cat tests/a.js; node --test tests/a.js; k6 run load/run.js" } },
    { toolName: "bash", input: { command: "echo x > src/app.ts" } },
    { toolName: "codemode", input: { code: 'await tools.read({path: "tests/a.js"}); await tools.bash({command: "node --test tests/a.js"}); await tools.write({path: "src/app.ts", content: "x"})' } },
    { toolName: "codemode", input: { code: '// cat > tests/not-written.js\nawait tools.read({path: "src/app.ts"});' } },
    { toolName: "codemode", input: { code: '/* cat > tests/not-written.js */ await tools.read({path: "src/app.ts"});' } },
    { toolName: "codemode", input: { code: 'const text = "cat > tests/not-written.js"; await tools.read({path: "src/app.ts"});' } },
    { toolName: "codemode", input: { code: 'await tools.write({path: "src/app.ts", content: `// cat > tests/x.js\nexport const a = 1;`});' } },
    { toolName: "codemode", input: { code: 'await tools.bash({command: `echo ${value} > tests/a.js`});' } },
    { toolName: "codemode", input: { code: 'await tools.write({path: target, content: "x"})' } },
    { toolName: "codemode", input: { code: 'await tools.bash({command: command}); await tools.bash({command: "cat tests/a.js"}); await tools.bash({command: "echo x > src/app.ts"})' } },
  ]) {
    const output = invoke(cwd, changes);
    assert.equal(output.result, null, JSON.stringify(changes));
    assert.equal(output.unchanged, true);
    assert.deepEqual(output.notifications, []);
  }
});
