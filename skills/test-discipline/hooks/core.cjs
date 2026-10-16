const fs = require("node:fs");
const path = require("node:path");

/* L3-L6 -- 共享核心
 * IN: 已校验的绝对 cwd；filePath 为非空路径或 null（按 cwd 注入子 agent 上下文）。
 * OUT: 命中或子 agent 启动时返回文本，普通文件返回 null；只读本地文件，无状态。
 * CHAIN: .git 仓根（无则 cwd）-> 根 AGENTS.md 首条索引 -> 无合法项时常见落点。
 * INVARIANT: 索引在此校验一次，拒绝绝对路径及词法或 symlink 越界；失效项只进诊断。
 * INVARIANT: 最近 AGENTS.md 不越过仓根；自检正文只由 SKILL.md 拥有。
 * FAIL: 索引失效逐项报告固定原因；读取异常显式抛错，由调用方映射 stderr 与退出码。
 * TEST: repo://skills/test-discipline/tests/hook.test.cjs
 */

function repositoryRoot(directory, fallback) {
  for (let current = directory; ; current = path.dirname(current)) {
    try {
      const marker = fs.statSync(path.join(current, ".git"));
      if (marker.isDirectory() || marker.isFile()) return current;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    if (path.dirname(current) === current) return fallback;
  }
}

function isTestFile(relative) {
  const segments = relative.split("/");
  const filename = segments.pop();
  return /\.(test|spec|bench|k6)\./.test(filename)
    || /_test\.(go|py)$/.test(filename)
    || /^test_.*\.py$/.test(filename)
    || /_bench/.test(filename)
    || ["conftest.py", "locustfile.py"].includes(filename)
    || segments.some((segment) => [
      "test", "tests", "__tests__", "e2e", "load", "perf", "bench", "benchmark", "loadtest",
    ].includes(segment));
}

function readChecklist(skillDirectory) {
  let markdown;
  try {
    markdown = fs.readFileSync(path.join(skillDirectory, "SKILL.md"), "utf8");
  } catch (error) {
    throw new Error(`无法读取写前自检小节：无法读取 SKILL.md（${error.code}）`, { cause: error });
  }
  const body = markdown.split(/^## 写前自检\r?\n/m)[1]?.split(/^## /m)[0];
  if (!body?.trim()) throw new Error("无法读取写前自检小节：缺少 ## 写前自检 或正文为空");
  return body;
}

function isFile(filename) {
  try {
    return fs.statSync(filename).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function isWithin(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function indexFailure(root, raw) {
  if (!raw.startsWith("repo://")) return "缺少 repo:// 前缀";
  const relative = raw.slice("repo://".length);
  if (path.isAbsolute(relative)) return "不允许绝对路径";
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute)) return "越出仓根";
  if (fs.existsSync(absolute) && !isWithin(fs.realpathSync(root), fs.realpathSync(absolute))) return "越出仓根";
  if (relative.includes("\0") || !isFile(absolute)) return "文件不存在";
  return null;
}

function indexedStandards(root) {
  const agents = path.join(root, "AGENTS.md");
  const line = isFile(agents)
    ? fs.readFileSync(agents, "utf8").split(/\r?\n/).find((line) => line.startsWith("测试规范："))
    : undefined;
  const valid = [];
  const invalid = [];
  for (const raw of line ? line.slice("测试规范：".length).split("、").map((value) => value.trim()) : []) {
    const reason = indexFailure(root, raw);
    if (reason) invalid.push(`索引失效：${raw}（${reason}）\n`);
    else valid.push(path.relative(root, path.resolve(root, raw.slice("repo://".length))));
  }
  return { valid, invalid };
}

function nearestAgents(root, directory) {
  for (let current = directory; isWithin(root, current); current = path.dirname(current)) {
    const agents = path.join(current, "AGENTS.md");
    if (isFile(agents)) return `最近 AGENTS.md：${path.relative(root, agents)}\n`;
    if (current === root) break;
  }
  return "";
}

function projectContext(root, directory) {
  const { valid, invalid } = indexedStandards(root);
  const standards = valid.length ? valid : [
    "docs/agents/quality-standards.md", "docs/agents/ui-e2e.md", "TESTING.md",
    "CONTRIBUTING.md", "CODING_STANDARDS.md",
  ].filter((file) => isFile(path.join(root, file)));
  const source = valid.length ? "测试规范索引" : "常见落点";
  const location = standards.length
    ? `项目测试规范（来源：${source}）：\n${standards.map((file) => `- ${file}\n`).join("")}`
    : "";
  const missing = standards.length ? "" : "无项目测试规范：按下方写前自检判断；用户要求时可运行 test-discipline 建档。\n";
  return location + nearestAgents(root, directory) + invalid.join("") + missing;
}

function buildContext(cwd, filePath = null) {
  const absolute = filePath === null ? cwd : path.resolve(cwd, filePath);
  const directory = filePath === null ? cwd : path.dirname(absolute);
  const root = repositoryRoot(directory, cwd);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!isWithin(root, absolute)) return null;
  if (filePath !== null && !isTestFile(relative)) return null;

  const skillDirectory = path.dirname(path.dirname(fs.realpathSync(__filename)));
  const body = readChecklist(skillDirectory);
  const explanation = path.resolve(skillDirectory, "../test-review/references/test-heuristics.md");
  const heading = filePath === null ? "[test-discipline]\n" : `[test-discipline] 命中测试文件：${relative}\n`;
  const text = heading + projectContext(root, directory) + body;
  return fs.existsSync(explanation) ? `${text}\n深层说明：${explanation}` : text;
}

module.exports = { buildContext };
