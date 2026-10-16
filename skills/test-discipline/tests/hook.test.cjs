const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const skill = path.resolve(__dirname, "..");
const entry = path.join(skill, "hooks/entry.cjs");

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-discipline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(t, relative = "project") {
  const repo = path.join(sandbox(t), relative);
  fs.mkdirSync(repo, { recursive: true });
  const init = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  return repo;
}

function event(cwd, filePath, tool = "Write") {
  return { hook_event_name: "PreToolUse", tool_name: tool, cwd, tool_input: { file_path: filePath } };
}

function invoke(input, script = entry, env = {}) {
  const environment = { ...process.env, TEST_DISCIPLINE_HOOK: "1", ...env };
  delete environment.FORCE_COLOR;
  delete environment.COLORTERM;
  return spawnSync(process.execPath, [script, "claude"], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: environment,
    timeout: 5000,
  });
}

function context(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
  assert.deepEqual(Object.keys(output.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
  assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
  return output.hookSpecificOutput.additionalContext;
}

function silent(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

test("缝 1 #1：Claude Write 测试文件收到写前自检与深层说明", (t) => {
  const text = context(invoke(event(repository(t), "src/a.test.ts")));
  assert.match(text, /^\[test-discipline\] 命中测试文件：src\/a\.test\.ts\n/);
  assert.ok(text.includes("1. 它验证哪个已接受的需求或具体缺陷？"));
  assert.ok(text.includes(`深层说明：${path.resolve(skill, "../test-review/references/test-heuristics.md")}`));
});

test("缝 1 #2：Claude Edit 压测目录命中", (t) => {
  const text = context(invoke(event(repository(t), "load/run.js", "Edit")));
  assert.match(text, /^\[test-discipline\] 命中测试文件：load\/run\.js\n/);
});

test("缝 1 #3：普通源码静默放行", (t) => {
  silent(invoke(event(repository(t), "src/app.ts", "Edit")));
});

test("缝 1 #4：仓根上层 test 目录不触发提醒", (t) => {
  const repo = repository(t, "test/project");
  silent(invoke(event(repo, path.join(repo, "src/app.ts"), "Edit")));
});

test("缝 1 #10：命中时始终输出无规范提示", (t) => {
  const repo = repository(t);
  const text = context(invoke(event(repo, "a.spec.js")));
  assert.ok(text.includes("无项目测试规范：按下方写前自检判断；用户要求时可运行 test-discipline 建档。"));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "测试规范：repo://TESTING.md\n");
  fs.writeFileSync(path.join(repo, "TESTING.md"), "现有规范\n");
  const withSpec = context(invoke(event(repo, "a.spec.js")));
  assert.equal(withSpec, text);
});

test("缝 1 #12：运行时原样读取写前自检小节，不注入相邻小节", (t) => {
  const copy = path.join(sandbox(t), "skills/test-discipline");
  fs.cpSync(skill, copy, { recursive: true });
  const body = "\n独立的自检规则，保留空白。  \n\n### 子标题\n仍在写前自检内。\n\n";
  fs.writeFileSync(path.join(copy, "SKILL.md"), `# 标题\n\n## 写前自检\n${body}## 相邻小节\n不应注入\n`);
  const text = context(invoke(event(repository(t), "test_a.py"), path.join(copy, "hooks/entry.cjs")));
  assert.ok(text.includes(body));
  assert.ok(!text.includes("不应注入"));
  assert.ok(!text.includes("它验证哪个已接受的需求"));
  assert.ok(!text.includes("深层说明："));
});

test("缝 1 #13：关闭开关不输出，连非法 JSON 也不解析", (t) => {
  silent(invoke(event(repository(t), "a.test.js"), entry, { TEST_DISCIPLINE_HOOK: "0" }));
  silent(invoke("not JSON", entry, { TEST_DISCIPLINE_HOOK: "0" }));
});

test("缝 1 #14：非 JSON 有稳定错误，退出 1 而非 2", () => {
  const result = invoke("not JSON");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "test-discipline: stdin 不是合法 JSON\n");
});

test("第 2 节：所有命名类别与完整目录段命中，近似目录及大小写不误判", (t) => {
  const repo = repository(t);
  const matches = [
    "x.test.ts", "x.spec.js", "x_test.go", "test_x.py", "x_test.py", "conftest.py",
    "x.bench.js", "x_benchmark.py", "locustfile.py", "x.k6.ts",
    "test/data.json", "tests/data.json", "__tests__/x.ts", "e2e/run.js", "load/run.js",
    "perf/run.js", "bench/run.js", "benchmark/run.js", "loadtest/run.js",
  ];
  for (const file of matches) {
    const text = context(invoke(event(repo, file)));
    assert.ok(text.startsWith(`[test-discipline] 命中测试文件：${file}\n`), file);
  }
  for (const file of ["contest/x.ts", "tests-old/x.ts", "payload/x.ts", "Tests/x.ts", "x.TEST.ts", "src/conftest.py.txt"]) {
    silent(invoke(event(repo, file)));
  }
});

test("仓根定位支持 .git 文件、嵌套 cwd、路径规范化与无 git 回退", (t) => {
  const repo = repository(t, "tests/project");
  fs.rmSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git"), "gitdir: /unused/worktree-marker\n");
  const cwd = path.join(repo, "src");
  fs.mkdirSync(cwd);
  assert.match(context(invoke(event(cwd, "../tests/./a.spec.ts", "MultiEdit"))), /命中测试文件：tests\/a\.spec\.ts\n/);
  silent(invoke(event(cwd, "../src/app.ts")));
  const noGit = sandbox(t);
  assert.match(context(invoke(event(noGit, "tests/a.js"))), /命中测试文件：tests\/a\.js\n/);
  silent(invoke(event(noGit, "../outside.test.js")));
});

test("第 10 节：缺字段或错误类型显式失败，不处理的工具与事件静默", (t) => {
  const valid = event(repository(t), "a.test.js");
  const inputs = [
    [{ ...valid, tool_input: {} }, "PreToolUse 缺少 tool_input.file_path"],
    [{ ...valid, tool_input: { file_path: 7 } }, "PreToolUse 缺少 tool_input.file_path"],
    [{ ...valid, cwd: undefined }, "PreToolUse 缺少 cwd"],
    [{ ...valid, tool_name: undefined }, "PreToolUse 缺少 tool_name"],
    [null, "事件必须为 JSON 对象"],
    [{}, "事件缺少 hook_event_name"],
  ];
  for (const [input, message] of inputs) {
    const result = invoke(input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `test-discipline: ${message}\n`);
  }
  silent(invoke({ hook_event_name: "PreToolUse", tool_name: "Bash" }));
  silent(invoke({ hook_event_name: "SubagentStart" }));
});

test("第 10 节：SKILL.md 缺失或没有写前自检小节时输出稳定错误", (t) => {
  const copy = path.join(sandbox(t), "test-discipline");
  fs.cpSync(skill, copy, { recursive: true });
  const script = path.join(copy, "hooks/entry.cjs");
  const input = event(repository(t), "a.test.js");
  fs.unlinkSync(path.join(copy, "SKILL.md"));
  let result = invoke(input, script);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "test-discipline: 无法读取写前自检小节：无法读取 SKILL.md（ENOENT）\n");
  fs.writeFileSync(path.join(copy, "SKILL.md"), "## 其他小节\n内容\n");
  result = invoke(input, script);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "test-discipline: 无法读取写前自检小节：缺少 ## 写前自检 或正文为空\n");
  silent(invoke(event(input.cwd, "src/app.ts"), script));
});

test("关闭开关在 stdin 保持打开且没有内容时也立即退出", async () => {
  const child = spawn(process.execPath, [entry, "claude"], {
    env: { ...process.env, TEST_DISCIPLINE_HOOK: "0" },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "");
  assert.equal(stderr, "");
});
