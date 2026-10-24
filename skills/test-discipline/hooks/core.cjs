const fs = require("node:fs");
const path = require("node:path");

/* L3-L6 -- 共享核心
 * IN: 已校验的绝对 cwd；filePath 为非空路径、路径数组或 null（按 cwd 注入子 agent 上下文）。
 * IN: buildPatchContext 接收已校验的补丁全文；extractWriteTargets 接收命令或 codemode 文本。
 * OUT: 写入目标解析只提取字面量路径；文件判定与多文件规范定位仍归 buildContext。
 * OUT: 多文件只组装一次，去重后列全命中项；规范与最近 AGENTS.md 取首个命中文件的仓。
 * OUT: 命中时展开自检并声明本提醒只追加文本；子 agent 启动只给规范与条件导航，普通文件返回 null。
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

function testFileLocation(cwd, absolute) {
  const directory = path.dirname(absolute);
  const root = repositoryRoot(directory, cwd);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  return isWithin(root, absolute) && isTestFile(relative) ? { absolute, root, directory } : null;
}

function buildContext(cwd, filePath = null) {
  const paths = filePath === null ? [] : Array.isArray(filePath) ? filePath : [filePath];
  const absolutePaths = [...new Set(paths.map((file) => path.resolve(cwd, file)))];
  const matches = absolutePaths.map((file) => testFileLocation(cwd, file)).filter(Boolean);
  if (filePath !== null && matches.length === 0) return null;
  const { root, directory } = matches[0] || { root: repositoryRoot(cwd, cwd), directory: cwd };
  const filenames = matches.map(({ absolute }) => path.relative(root, absolute).split(path.sep).join("/"));
  const skillDirectory = path.dirname(path.dirname(fs.realpathSync(__filename)));
  const explanation = path.resolve(skillDirectory, "../test-review/references/test-heuristics.md");
  const heading = filePath === null
    ? "[test-discipline]\n"
    : `[test-discipline] 命中测试文件：${filenames.join("、")}\n本提醒只追加文本，不拦截、不改写工具调用或输出。\n`;
  const location = heading + projectContext(root, directory);
  if (filePath === null) return `${location}仅在新增、修改或删除测试时，先读 ${path.join(skillDirectory, "SKILL.md")}「写前自检」。只读任务按审查要求核对测试，无需逐条作答。\n`;
  const text = location + readChecklist(skillDirectory);
  return fs.existsSync(explanation) ? `${text}\n深层说明：${explanation}` : text;
}

function buildPatchContext(cwd, patch) {
  const paths = patch.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+?)\s*$/);
    return match?.[1].trim() ? [match[1]] : [];
  });
  return buildContext(cwd, paths);
}

function unquoteWord(raw, maskExpansions = false) {
  return raw.replace(/'([^']*)'|"((?:\\[\s\S]|[^"\\])*)"|\\\r?\n|\\(.)|([$`])/g,
    (_, single, double, escaped, expansion) => {
      if (single !== undefined) return single;
      if (double === undefined) return escaped ?? (expansion && maskExpansions ? "\0" : expansion ?? "");
      return double.replace(/\\\r?\n|\\([\\"$`])|([$`])/g,
        (_, escaped, expansion) => escaped ?? (expansion && maskExpansions ? "\0" : expansion ?? ""));
    });
}

function literalTarget(raw) {
  if (!raw || raw.includes("\0")) return null;
  const expansions = raw.replace(/'[^']*'|"(?:\\.|[^"\\])*"|\\./g,
    (part) => part[0] === '"' ? part.slice(1, -1).replace(/\\[\\"$`]|[^$`]/g, "") : "");
  return /[$`*?{}\[\]~]/.test(expansions) ? null : unquoteWord(raw);
}

function commandLines(command) {
  const shell = [];
  const code = [];
  let logical = "";
  let offset = 0;
  let patch = false;
  let heredocs = [];
  for (const line of command.split("\n")) {
    const text = line.replace(/\r$/, "");
    if (text.trim() === "*** Begin Patch") patch = true;
    const heredoc = heredocs[0];
    const hidden = patch || Boolean(heredoc);
    if (patch && text.trim() === "*** End Patch") patch = false;
    else if (heredoc) {
      heredoc.index ??= offset;
      if ((heredoc.tabs ? text.replace(/^\t+/, "") : text) === heredoc.end) {
        const body = heredoc.body.join("\n");
        const codeText = heredoc.expand ? body.replace(/\\\r?\n|\\([$`\\])|([$`])/g,
          (_, escaped, expansion) => escaped ?? (expansion ? "\0" : "")) : body;
        if (heredoc.code) code.push({ text: codeText, index: heredoc.index });
        heredocs.shift();
      } else heredoc.body.push(text);
    } else if (!hidden) {
      logical += line + "\n";
      const continued = [...logical.matchAll(/'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\\r?\n|\\[\s\S]/g)]
        .some((match) => /^\\\r?\n$/.test(match[0]) && match.index + match[0].length === logical.length);
      const tokens = continued ? [] : shellTokens(logical);
      if (!continued) logical = "";
      heredocs = tokens.flatMap(({ raw }, index) => ["<<", "<<-"].includes(raw) && tokens[index + 1] ? [{
        end: unquoteWord(tokens[index + 1].raw), expand: !/['"\\]/.test(tokens[index + 1].raw),
        tabs: raw === "<<-", body: [], index: null,
      }] : []);
      if (heredocs.length && /^(?:python[\d.]*|node)$/.test(tokens[0]?.raw || "")) heredocs.at(-1).code = true;
    }
    shell.push(hidden ? " ".repeat(line.length) : line);
    offset += line.length + 1;
  }
  return { shell: shell.join("\n"), code };
}

function shellTokens(command) {
  const pattern = /#[^\n]*|(?:[^\s'"\\;&|<>()]+|'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\[\s\S])+|>>|<<<|<<-?|&&|\|\||[^\s]/g;
  return [...command.matchAll(pattern)].filter(([raw]) => !raw.startsWith("#") && !/^(?:\\\r?\n)+$/.test(raw))
    .map((match) => ({ raw: match[0], index: match.index }));
}

function codeLiteral(raw, shellCommand = false) {
  if (!raw || !/^["'`]/.test(raw) || raw.at(-1) !== raw[0]) return null;
  const value = raw.slice(1, -1);
  if (value.includes("\0") || (raw[0] === "`" && value.includes("${"))) return null;
  const escapes = { "\\": "\\", "'": "'", '"': '"', "`": "`", ...(shellCommand ? { n: "\n", r: "\r", t: "\t" } : {}) };
  let valid = true;
  const decoded = value.replace(/\\([\s\S]?)/g, (_, escaped) => {
    if (Object.hasOwn(escapes, escaped)) return escapes[escaped];
    valid = false;
    return "";
  });
  return valid ? decoded : null;
}

function objectPath(tokens, start, key = "path") {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index].raw;
    if (token === "}" && depth === 0) return null;
    if (depth === 0 && (token === key || codeLiteral(token) === key)
        && tokens[index + 1]?.raw === ":" && [",", "}"].includes(tokens[index + 3]?.raw)) {
      return codeLiteral(tokens[index + 2]?.raw, key === "command");
    }
    if (["{", "[", "("].includes(token)) depth += 1;
    if (["}", "]", ")"].includes(token)) depth -= 1;
  }
  return null;
}

function codeTargets(code, offset = 0) {
  const pattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|[a-zA-Z_$][\w$]*|[^\s]/g;
  const tokens = [...code.matchAll(pattern)].filter(([raw]) => !/^(?:\/\/|\/\*|#)/.test(raw))
    .map((match) => ({ raw: match[0], index: offset + match.index }));
  const paths = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const tail = tokens.slice(index, index + 8).map(({ raw }) => raw);
    let target = null;
    if (tail[0] === "Path" && tail[1] === "(" && tail[3] === ")" && tail[4] === "."
        && ["write_text", "write_bytes"].includes(tail[5]) && tail[6] === "(") target = codeLiteral(tail[2]);
    if (["writeFileSync", "writeFile"].includes(tail[0]) && tail[1] === "(" && tail[3] === ",") target = codeLiteral(tail[2]);
    if (tail[0] === "open" && tail[1] === "(" && tail[3] === "," && /^[wa][b+t]*$/.test(codeLiteral(tail[4]) || "")
        && [",", ")"].includes(tail[5])) target = codeLiteral(tail[2]);
    if (tail[0] === "tools" && tail[1] === "." && ["edit", "write"].includes(tail[2])
        && tail[3] === "(" && tail[4] === "{") target = objectPath(tokens, index + 5);
    if (tail[0] === "tools" && tail[1] === "." && tail[2] === "bash" && tail[3] === "(" && tail[4] === "{") {
      const command = objectPath(tokens, index + 5, "command");
      if (command !== null) paths.push(...extractWriteTargets(command).map((path) => ({ path, index: tokens[index].index })));
    }
    if (target) paths.push({ path: target, index: tokens[index].index });
  }
  return paths;
}

function inPlaceFiles(tokens, program) {
  let inPlace = false;
  let expression = program === "sed";
  const files = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const word = unquoteWord(tokens[index].raw);
    if (word === "") continue;
    const option = word.match(/^-([^-ef]*)([ef])?(.*)$/);
    if (option) {
      inPlace ||= option[1].includes("i");
      if (option[2]) { index += option[3] ? 0 : 1; expression = false; }
      continue;
    }
    if (word.startsWith("-")) continue;
    if (expression) { expression = false; continue; }
    files.push(tokens[index]);
  }
  return inPlace ? files : [];
}

function utilityTargets(tokens) {
  const words = [...tokens];
  let program = words.shift()?.raw;
  if (program === "git") program = words.shift()?.raw;
  if (["sed", "perl"].includes(program)) return inPlaceFiles(words, program);
  const operands = words.filter(({ raw }) => !unquoteWord(raw).startsWith("-"));
  if (["cp", "mv"].includes(program)) return operands.length >= 2 ? operands.slice(-1) : [];
  return ["tee", "rm"].includes(program) ? operands : [];
}

function statementTargets(tokens) {
  const paths = utilityTargets(tokens).map(({ raw, index }) => ({ path: literalTarget(raw), index }));
  if (!/^(?:python[\d.]*|node)$/.test(tokens[0]?.raw || "")) return paths;
  const flag = tokens.findIndex(({ raw }) => ["-c", "-e", "--eval"].includes(raw));
  const script = tokens[flag + 1];
  return flag !== -1 && script ? paths.concat(codeTargets(unquoteWord(script.raw, true), script.index)) : paths;
}

function shellTargets(shell) {
  const paths = [];
  const tokens = shellTokens(shell);
  let statement = [];
  let conditional = false;
  for (let index = 0; index <= tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    const newline = previous && token && shell.slice(previous.index + previous.raw.length, token.index).replace(/\\\r?\n/g, "").includes("\n");
    if (!token || newline || [";", "&&", "||", "|", "&"].includes(token.raw)) {
      paths.push(...statementTargets(statement));
      statement = [];
    }
    if (!token) break;
    if (token.raw === "[[") conditional = true;
    if (conditional) {
      if (token.raw === "]]") conditional = false;
      continue;
    }
    if ([">", ">>", "<", "<<<", "<<", "<<-"].includes(token.raw)) {
      if (previous && /^\d+$/.test(previous.raw) && previous.index + previous.raw.length === token.index) statement.pop();
      const next = tokens[index + 1];
      if ([">", ">>"].includes(token.raw) && next?.raw !== "&") paths.push({ path: literalTarget(next?.raw), index: token.index });
      index += next?.raw === "&" ? 2 : 1;
    } else if (![";", "&&", "||", "|", "&"].includes(token.raw)) statement.push(token);
  }
  return paths;
}

/* L4 -- 写入目标解析
 * IN: 已校验的命令或代码文本；syntax 默认 shell，Pi codemode 显式传 codemode。
 * INVARIANT: codemode 只经代码扫描；仅 tools.bash 的字面量 command 进入 shell 分支。
 * OUT: 按文本顺序返回去重路径，测试文件判定仍归 buildContext；补丁块与 heredoc 数据不当命令。
 * INVARIANT: 不执行命令、不启动子进程、不读写状态；变量路径、间接写入与代码生成不识别。
 * INVARIANT: 按 shell 引用、转义与 heredoc 分隔符区分展开和字面量；续行结束后才消费 heredoc 数据。
 * INVARIANT: tools.bash 的字面量 command 按转义单元一次解码（含换行、回车与 tab），拒绝模板插值。
 * TEST: repo://skills/test-discipline/tests/hook.test.cjs「缝 1 Bash」与 tests/pi.test.cjs「缝 2」。
 */
function extractWriteTargets(command, syntax = "shell") {
  const { shell, code } = syntax === "codemode" ? { shell: "", code: [{ text: command, index: 0 }] } : commandLines(command);
  const targets = shellTargets(shell).concat(codeTargets(shell), code.flatMap(({ text, index }) => codeTargets(text, index)));
  targets.sort((left, right) => left.index - right.index);
  return [...new Set(targets.map(({ path }) => path).filter(Boolean))];
}

module.exports = { buildContext, buildPatchContext, extractWriteTargets };
