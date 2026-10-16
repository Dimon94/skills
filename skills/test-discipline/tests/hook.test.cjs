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

function invoke(input, script = entry, env = {}, mode = "claude") {
  const environment = { ...process.env, TEST_DISCIPLINE_HOOK: "1", ...env };
  delete environment.FORCE_COLOR;
  delete environment.COLORTERM;
  return spawnSync(process.execPath, [script, mode], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: environment,
    timeout: 5000,
  });
}

function context(result, hookEventName = "PreToolUse") {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
  assert.deepEqual(Object.keys(output.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
  assert.equal(output.hookSpecificOutput.hookEventName, hookEventName);
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

test("缝 1 #5：Codex 多文件补丁只注入一份，完整列出命中文件", (t) => {
  const repo = repository(t);
  const command = [
    "*** Begin Patch", "*** Update File: src/app.ts", "@@", "-old", "+new",
    "*** Add File: tests/x_test.go", "+package tests",
    "*** Update File: tests/unit case.test.js  ", "@@", "-old", "+new",
    "*** Delete File: perf/old run.js", "*** End Patch",
  ].join("\n");
  const input = { hook_event_name: "PreToolUse", tool_name: "apply_patch", cwd: repo, tool_input: { command } };
  const text = context(invoke(input, entry, {}, "codex"));
  assert.equal(text.split("\n")[0], "[test-discipline] 命中测试文件：tests/x_test.go、tests/unit case.test.js、perf/old run.js");
  assert.equal(text.split("[test-discipline]").length - 1, 1);
  assert.ok(text.includes("1. 它验证哪个已接受的需求或具体缺陷？"));
  silent(invoke({ ...input, tool_input: { command: "*** Update File: src/app.ts\n" } }, entry, {}, "codex"));
});

test("缝 1 #6：Codex Move to 命中，跨仓规范取首个命中文件的仓根", (t) => {
  const cwd = repository(t, "test/project");
  const first = repository(t, "first");
  const second = repository(t, "second");
  fs.writeFileSync(path.join(cwd, "TESTING.md"), "事件工作仓的规范\n");
  fs.writeFileSync(path.join(first, "CONTRIBUTING.md"), "首个命中仓的规范\n");
  fs.writeFileSync(path.join(second, "CODING_STANDARDS.md"), "后续仓的规范\n");
  const command = [
    "*** Begin Patch", "*** Update File: src/app.ts", "*** Move to: tests/b.spec.ts", "@@", "+test",
    "*** Update File: tests/b.spec.ts", "*** End Patch",
  ].join("\n");
  const input = { hook_event_name: "PreToolUse", tool_name: "apply_patch", cwd, tool_input: { command } };
  assert.equal(context(invoke(input, entry, {}, "codex")).split("\n")[0], "[test-discipline] 命中测试文件：tests/b.spec.ts");
  const crossRepo = [
    "*** Update File: src/app.ts",
    `*** Add File: ${path.join(first, "tests/first case.js")}`,
    `*** Delete File: ${path.join(second, "load/second.js")}`,
  ].join("\r\n");
  const text = context(invoke({ ...input, tool_input: { command: crossRepo } }, entry, {}, "codex"));
  assert.ok(text.includes("项目测试规范（来源：常见落点）：\n- CONTRIBUTING.md\n"));
  assert.ok(!text.includes("TESTING.md"));
  assert.ok(!text.includes("CODING_STANDARDS.md"));
  assert.ok(text.includes("tests/first case.js"));
  assert.ok(text.includes("load/second.js"));
});

test("缝 1 #7：首条测试规范索引列出全部合法项，优先于常见落点", (t) => {
  const repo = repository(t);
  fs.mkdirSync(path.join(repo, "rules"));
  fs.writeFileSync(path.join(repo, "rules/unit.md"), "不应复制的单元规范正文\n");
  fs.writeFileSync(path.join(repo, "rules/e2e.md"), "不应复制的端到端规范正文\n");
  fs.writeFileSync(path.join(repo, "TESTING.md"), "常见落点\n");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), [
    " 测试规范：repo://ignored.md",
    "测试规范:repo://ignored.md",
    "测试规范： repo://rules/./unit.md 、 repo://rules/e2e.md ",
    "测试规范：repo://TESTING.md",
  ].join("\n"));
  const text = context(invoke(event(repo, "a.spec.js")));
  assert.ok(text.includes("项目测试规范（来源：测试规范索引）：\n- rules/unit.md\n- rules/e2e.md\n"));
  assert.ok(!text.includes("TESTING.md"));
  assert.ok(!text.includes("无项目测试规范"));
  assert.ok(!text.includes("索引失效"));
  assert.ok(!text.includes("不应复制"));
});

test("缝 1 #8：失效索引只列原值与首个原因，全部失效时回退", (t) => {
  const repo = repository(t);
  const outside = path.join(path.dirname(repo), "x.md");
  fs.writeFileSync(outside, "仓外规范\n");
  fs.symlinkSync(outside, path.join(repo, "escape.md"));
  fs.mkdirSync(path.join(repo, "rules"));
  fs.writeFileSync(path.join(repo, "TESTING.md"), "回退规范\n");
  const invalid = [
    ["/missing.md", "缺少 repo:// 前缀"],
    ["repo:///missing.md", "不允许绝对路径"],
    ["repo://../x.md", "越出仓根"],
    ["repo://rules/../../absent.md", "越出仓根"],
    ["repo://escape.md", "越出仓根"],
    ["repo://missing.md", "文件不存在"],
    ["repo://rules", "文件不存在"],
  ];
  const agents = path.join(repo, "AGENTS.md");
  const invalidIndex = invalid.map(([raw]) => raw).join("、");
  fs.writeFileSync(agents, `测试规范：${invalidIndex}\n`);
  let text = context(invoke(event(repo, "a.spec.js")));
  for (const [raw, reason] of invalid) {
    assert.ok(text.includes(`索引失效：${raw}（${reason}）\n`), raw);
  }
  assert.equal(text.split("索引失效：").length - 1, invalid.length);
  assert.deepEqual(text.split("\n").filter((line) => line.startsWith("- ")), ["- TESTING.md"]);
  assert.ok(text.includes("项目测试规范（来源：常见落点）："));
  assert.ok(!text.includes("无项目测试规范"));
  fs.writeFileSync(path.join(repo, "rules/valid.md"), "合法规范\n");
  fs.writeFileSync(agents, `测试规范：repo://rules/valid.md、${invalidIndex}\n测试规范：repo://TESTING.md\n`);
  text = context(invoke(event(repo, "a.spec.js")));
  assert.ok(text.includes("项目测试规范（来源：测试规范索引）：\n- rules/valid.md\n"));
  assert.ok(!text.includes("- TESTING.md\n"));
  assert.ok(text.includes("索引失效：repo://../x.md（越出仓根）"));
  fs.unlinkSync(path.join(repo, "TESTING.md"));
  fs.writeFileSync(agents, "测试规范：repo://missing.md\n");
  text = context(invoke(event(repo, "a.spec.js")));
  assert.ok(text.includes("索引失效：repo://missing.md（文件不存在）\n无项目测试规范："));
});

test("缝 1 #9：无索引时按合同顺序列出全部常见落点，不复制正文", (t) => {
  const repo = repository(t);
  const files = ["docs/agents/quality-standards.md", "docs/agents/ui-e2e.md", "TESTING.md", "CONTRIBUTING.md", "CODING_STANDARDS.md"];
  for (const file of files.toReversed()) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), "不应复制的规范正文\n");
  }
  const text = context(invoke(event(repo, "a.spec.js")));
  assert.ok(text.includes("项目测试规范（来源：常见落点）：\n- docs/agents/quality-standards.md\n- docs/agents/ui-e2e.md\n- TESTING.md\n- CONTRIBUTING.md\n- CODING_STANDARDS.md\n"));
  assert.ok(!text.includes("无项目测试规范"));
  assert.ok(!text.includes("不应复制"));
});

test("缝 1 #10：没有索引与常见落点时输出无规范提示", (t) => {
  const repo = repository(t);
  const text = context(invoke(event(repo, "a.spec.js")));
  assert.ok(text.includes("无项目测试规范：按下方写前自检判断；用户要求时可运行 test-discipline 建档。"));
});

test("缝 1 #11：最近 AGENTS.md 从文件目录向上查找，无 git 时止于事件 cwd", (t) => {
  const repo = repository(t);
  const module = path.join(repo, "src/module");
  fs.mkdirSync(module, { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "测试规范：repo://TESTING.md\n");
  fs.writeFileSync(path.join(repo, "TESTING.md"), "项目规范\n");
  fs.writeFileSync(path.join(module, "AGENTS.md"), "测试规范：repo://must-not-use.md\n");
  let text = context(invoke(event(repo, "src/module/tests/a.test.js")));
  assert.ok(text.includes("最近 AGENTS.md：src/module/AGENTS.md\n"));
  assert.ok(text.includes("- TESTING.md\n最近 AGENTS.md："));
  assert.ok(!text.includes("must-not-use.md"));
  fs.unlinkSync(path.join(module, "AGENTS.md"));
  text = context(invoke(event(module, "tests/a.test.js")));
  assert.ok(text.includes("最近 AGENTS.md：AGENTS.md\n"));
  const parent = sandbox(t);
  const noGit = path.join(parent, "workspace");
  fs.mkdirSync(noGit);
  fs.writeFileSync(path.join(parent, "AGENTS.md"), "仓外规则\n");
  fs.writeFileSync(path.join(noGit, "AGENTS.md"), "测试规范：repo://TESTING.md\n");
  fs.writeFileSync(path.join(noGit, "TESTING.md"), "无 git 规范\n");
  text = context(invoke(event(noGit, "missing/tests/a.js")));
  assert.ok(text.includes("项目测试规范（来源：测试规范索引）：\n- TESTING.md\n最近 AGENTS.md：AGENTS.md\n"));
  fs.unlinkSync(path.join(noGit, "AGENTS.md"));
  text = context(invoke(event(noGit, "missing/tests/a.js")));
  assert.ok(!text.includes("最近 AGENTS.md："));
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
  silent(invoke("not JSON", entry, { TEST_DISCIPLINE_HOOK: "0" }, "codex"));
});

test("缝 1 #14：非 JSON 有稳定错误，退出 1 而非 2", () => {
  for (const mode of ["claude", "codex"]) {
    const result = invoke("not JSON", entry, {}, mode);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "test-discipline: stdin 不是合法 JSON\n");
  }
});

test("缝 1 #15：SubagentStart 按会话 cwd 注入规范与自检，不依赖工具字段", (t) => {
  const repo = repository(t);
  const cwd = path.join(repo, "module");
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "测试规范：repo://rules.md\n");
  fs.writeFileSync(path.join(repo, "rules.md"), "规范正文\n");
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "模块规则\n");
  const input = { hook_event_name: "SubagentStart", cwd };
  for (const mode of ["claude", "codex"]) {
    let text = context(invoke(input, entry, {}, mode), "SubagentStart");
    assert.ok(text.startsWith("[test-discipline]\n项目测试规范（来源：测试规范索引）：\n- rules.md\n最近 AGENTS.md：module/AGENTS.md\n"));
    assert.ok(text.includes("1. 它验证哪个已接受的需求或具体缺陷？"));
    assert.ok(text.includes("深层说明："));
    assert.ok(!text.includes("命中测试文件"));
    assert.ok(!text.includes("无项目测试规范"));
    text = context(invoke({ ...input, cwd: sandbox(t) }, entry, {}, mode), "SubagentStart");
    assert.ok(text.startsWith("[test-discipline]\n无项目测试规范："));
    assert.ok(!text.includes("命中测试文件"));
    silent(invoke(input, entry, { TEST_DISCIPLINE_HOOK: "0" }, mode));
  }
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
    [{ ...valid, tool_name: "apply_patch", tool_input: {} }, "PreToolUse 缺少 tool_input.command", "codex"],
    [{ ...valid, tool_name: "apply_patch", tool_input: { command: 7 } }, "PreToolUse 缺少 tool_input.command", "codex"],
    [{ ...valid, tool_input: {} }, "PreToolUse 缺少 tool_input.file_path"],
    [{ ...valid, tool_input: { file_path: 7 } }, "PreToolUse 缺少 tool_input.file_path"],
    [{ ...valid, cwd: undefined }, "PreToolUse 缺少 cwd"],
    [{ ...valid, tool_name: undefined }, "PreToolUse 缺少 tool_name"],
    [null, "事件必须为 JSON 对象"],
    [{}, "事件缺少 hook_event_name"],
    [{ hook_event_name: "SubagentStart" }, "SubagentStart 缺少 cwd"],
    [{ hook_event_name: "SubagentStart", cwd: "relative" }, "SubagentStart cwd 必须是绝对路径"],
  ];
  for (const [input, message, mode = "claude"] of inputs) {
    const result = invoke(input, entry, {}, mode);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `test-discipline: ${message}\n`);
  }
  silent(invoke({ hook_event_name: "PreToolUse", tool_name: "Bash" }));
  silent(invoke({ hook_event_name: "SessionStart" }));
  silent(invoke({ hook_event_name: "PreToolUse", tool_name: "shell" }, entry, {}, "codex"));
  silent(invoke({ hook_event_name: "SessionStart" }, entry, {}, "codex"));
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
