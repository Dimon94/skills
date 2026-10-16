const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skill = path.resolve(__dirname, "..");
const extension = path.join(skill, "hooks/pi.js");
const original = [{ type: "text", text: "原工具结果" }, { type: "image", data: "AA==", mimeType: "image/png" }];
const runner = `
  import { pathToFileURL } from "node:url";
  const { default: register } = await import(pathToFileURL(process.env.TEST_EXTENSION));
  let handler;
  register({ on(name, callback) {
    if (name !== "tool_result") throw new Error("错误的事件订阅");
    handler = callback;
  } });
  if (process.env.NEXT_SWITCH) process.env.TEST_DISCIPLINE_HOOK = process.env.NEXT_SWITCH;
  const event = JSON.parse(process.env.TEST_EVENT);
  const before = JSON.stringify(event);
  const notifications = [];
  const result = await handler?.(event, {
    cwd: process.env.TEST_CWD,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  });
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
    ...process.env, TEST_DISCIPLINE_HOOK: "1", TEST_EXTENSION: extension, TEST_CWD: cwd,
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
  assert.ok(appended.text.includes("1. 它验证哪个已接受的需求或具体缺陷？"));
  assert.ok(appended.text.includes("项目测试规范（来源：测试规范索引）：\n- TESTING.md\n最近 AGENTS.md：AGENTS.md\n"));
  assert.ok(!appended.text.includes("项目规范正文不应注入"));
  assert.deepEqual(output.result.structuredContent, { answer: 7, nested: ["a"] });
  assert.equal(output.sameStructured, true);
  assert.equal(output.unchanged, true);
  assert.deepEqual(output.notifications, []);
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
  for (const changes of [{ isError: true }, { parentToolCallId: "parent" }]) {
    const output = invoke(cwd, changes);
    assert.equal(output.result, null);
    assert.equal(output.unchanged, true);
    assert.deepEqual(output.notifications, []);
  }
});

test("缝 2 #2：edit 普通源码与其他工具不追加", (t) => {
  const cwd = sandbox(t);
  for (const changes of [
    { toolName: "edit", input: { path: "src/app.ts" } },
    { toolName: "read" },
  ]) {
    const output = invoke(cwd, changes);
    assert.equal(output.result, null);
    assert.equal(output.unchanged, true);
    assert.deepEqual(output.notifications, []);
  }
});
