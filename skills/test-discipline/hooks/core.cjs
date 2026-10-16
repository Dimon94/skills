const fs = require("node:fs");
const path = require("node:path");

/* L3/L4 -- 共享核心
 * IN: 调用方已校验的绝对 cwd 与非空 filePath；相对路径按 cwd 解析。
 * OUT: 命中时返回注入文本，未命中返回 null；只读本地文件，无运行期状态。
 * INVARIANT: 只匹配仓根之下的相对部分；规则正文只由 SKILL.md 拥有。
 * FAIL: 小节读取失败显式抛错；调用方负责映射 stderr 与退出码。
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

function buildContext(cwd, filePath) {
  const absolute = path.resolve(cwd, filePath);
  const root = repositoryRoot(path.dirname(absolute), cwd);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) return null;
  if (!isTestFile(relative)) return null;

  const skillDirectory = path.dirname(path.dirname(fs.realpathSync(__filename)));
  const body = readChecklist(skillDirectory);
  const explanation = path.resolve(skillDirectory, "../test-review/references/test-heuristics.md");
  const text = `[test-discipline] 命中测试文件：${relative}\n`
    + "无项目测试规范：按下方写前自检判断；用户要求时可运行 test-discipline 建档。\n"
    + body;
  return fs.existsSync(explanation) ? `${text}\n深层说明：${explanation}` : text;
}

module.exports = { buildContext };
