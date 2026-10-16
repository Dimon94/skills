#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

/* L3-L6 -- 安装边界
 * COORD: repo://skills/test-discipline/scripts/install-hooks.cjs
 * INPUT: 本地 JSON 配置与 Pi symlink；本 Skill 的真实 hooks 路径用于识别注册位置。
 * OUTPUT: 目标表内的 hook 注册、卸载与只读状态；不修改 hook 运行逻辑。
 * PARAM: 无参数安装；--check 只读；--uninstall 卸载，三者互斥。CLAUDE_SETTINGS 覆盖 ~/.claude/settings.json。
 * PARAM: PI_EXTENSIONS_DIR 覆盖 ~/.pi/agent/extensions，目标名为 test-discipline.js。
 * INVARIANT: 按安装器命令中的绝对入口认领；他人配置保序；键序不影响检查；无变化不写。
 * CHAIN: 参数 -> 读取并校验全部目标 -> 清理本 Skill 条目与因此清空的组 -> 安装时追加 -> 变化前备份 -> 原子替换。
 * INVARIANT: Pi 安装拒绝覆盖非 symlink；检查缺失为 missing、指向当前扩展为 installed，其余为 drift。
 * OUT: Pi 卸载只删解析后指向当前扩展的 symlink；变化前备份链接本身，含失效链接。
 * OUT: 卸载不创建缺失配置；重复卸载无写入；保留原有空组、事件与其他配置。
 * FAIL: 输入或写入失败退出 1；修正报错路径的配置或权限后重试。
 * TEST: repo://skills/test-discipline/tests/install.test.cjs
 * PROTOCOL: 公开参数变更同步 repo://skills/test-discipline/SKILL.md「安装」。
 */

const hooksDirectory = fs.realpathSync(path.resolve(__dirname, "../hooks"));
const command = `node '${path.join(hooksDirectory, "entry.cjs").replaceAll("'", "'\\''")}' claude`;
const targets = [{
  name: "Claude",
  file: path.resolve(process.env.CLAUDE_SETTINGS || path.join(os.homedir(), ".claude/settings.json")),
  groups: {
    PreToolUse: [{ matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command, timeout: 5 }] }],
    SubagentStart: [{ hooks: [{ type: "command", command, timeout: 5 }] }],
  },
}, {
  name: "Pi",
  file: path.resolve(process.env.PI_EXTENSIONS_DIR || path.join(os.homedir(), ".pi/agent/extensions"), "test-discipline.js"),
  source: path.join(hooksDirectory, "pi.js"),
}];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateConfig(config) {
  if (!isObject(config)) throw new Error("配置必须为 JSON 对象");
  if (config.hooks === undefined) return;
  if (!isObject(config.hooks)) throw new Error("hooks 必须为对象");
  for (const groups of Object.values(config.hooks)) {
    if (!Array.isArray(groups)) throw new Error("hook 事件必须为数组");
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.every(isObject)) {
        throw new Error("matcher 组必须包含 hook 对象数组");
      }
    }
  }
}

function readLink(target, install) {
  let originalLink;
  try {
    originalLink = fs.readlinkSync(target.file);
  } catch (error) {
    if (error.code === "ENOENT") return { ...target, link: undefined };
    if (error.code !== "EINVAL") throw error;
    if (install) throw new Error(`${target.file} 不是 symlink，拒绝覆盖；移走用户文件后重试`);
    return { ...target, link: null };
  }
  return { ...target, originalLink, link: path.resolve(path.dirname(target.file), originalLink) };
}

function readTarget(target, install) {
  if (target.source) return readLink(target, install);
  let original;
  try {
    original = fs.readFileSync(target.file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let config;
  try {
    config = original === undefined ? {} : JSON.parse(original);
  } catch (error) {
    throw new Error(`${target.file} 不是合法 JSON；修正后重试`, { cause: error });
  }
  validateConfig(config);
  return { ...target, original, config };
}

function isOwned(hook) {
  if (typeof hook.command !== "string") return false;
  // 只认安装器生成的调用形态；反解 shell 单引号后校验绝对入口，兼容仓库迁移。
  const match = hook.command.match(/^node '((?:[^']|'\\'')*)'(?:\s|$)/);
  if (!match) return false;
  const entry = match[1].replaceAll("'\\''", "'");
  return path.isAbsolute(entry) && entry.endsWith("/test-discipline/hooks/entry.cjs");
}

function registrations(hooks) {
  return Object.entries(hooks).sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([event, groups]) => groups.flatMap((group) =>
      group.hooks.filter(isOwned).map((hook) => ({ event, matcher: group.matcher, hook }))));
}

function checkTarget(target) {
  if (target.source) {
    if (target.link === undefined) return "missing";
    return target.link === target.source ? "installed" : "drift";
  }
  const actual = registrations(target.config.hooks || {});
  if (actual.length === 0) return "missing";
  const expected = registrations(target.groups);
  return isDeepStrictEqual(actual, expected) ? "installed" : "drift";
}

function updateConfig(target, uninstall) {
  if (uninstall && target.config.hooks === undefined) return target.config;
  const hooks = { ...target.config.hooks };
  for (const [event, groups] of Object.entries(hooks)) {
    hooks[event] = groups.flatMap((group) => {
      const remaining = group.hooks.filter((hook) => !isOwned(hook));
      if (remaining.length === group.hooks.length) return [group];
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
  }
  if (!uninstall) {
    for (const [event, groups] of Object.entries(target.groups)) {
      hooks[event] = [...(hooks[event] || []), ...groups];
    }
  }
  return { ...target.config, hooks };
}

function backup(target) {
  // 秒级文件名可能碰撞；递增名称，不覆盖前一次恢复点。
  for (let time = Date.now(); ; time += 1000) {
    const stamp = new Date(time).toISOString().replace(/\D/g, "").slice(0, 14);
    try {
      const file = `${target.file}.test-discipline.bak-${stamp}`;
      if (target.source) fs.symlinkSync(target.originalLink, file);
      else fs.copyFileSync(target.file, file, fs.constants.COPYFILE_EXCL);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

function writeTarget(target, config) {
  if (JSON.stringify(config) === JSON.stringify(target.config)) return;
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  const mode = target.original === undefined ? 0o600 : fs.statSync(target.file).mode & 0o777;
  if (target.original !== undefined) backup(target);
  const temporary = fs.mkdtempSync(path.join(path.dirname(target.file), ".test-discipline-"));
  try {
    const file = path.join(temporary, "settings.json");
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode });
    fs.chmodSync(file, mode);
    fs.renameSync(file, target.file);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function writeLink(target, uninstall) {
  if (uninstall ? target.link !== target.source : target.link === target.source) return;
  if (target.link !== undefined) backup(target);
  if (uninstall) {
    fs.unlinkSync(target.file);
    return;
  }
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(target.file), ".test-discipline-"));
  try {
    const file = path.join(temporary, "test-discipline.js");
    fs.symlinkSync(target.source, file);
    fs.renameSync(file, target.file);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !["--check", "--uninstall"].includes(args[0]))) {
    throw new Error("用法：node install-hooks.cjs [--check|--uninstall]；移除其他参数后重试");
  }
  const uninstall = args[0] === "--uninstall";
  const loaded = targets.map((target) => readTarget(target, args.length === 0));
  for (const target of loaded) {
    if (args[0] !== "--check") {
      if (target.source) writeLink(target, uninstall);
      else writeTarget(target, updateConfig(target, uninstall));
    }
    const status = args[0] === "--check" ? checkTarget(target) : uninstall ? "uninstalled" : "installed";
    process.stdout.write(`${target.name}: ${status}\n`);
    if (args[0] === "--check" && status !== "installed") process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`test-discipline: ${error.message}（目标：${targets.map((target) => target.file).join("、")}）；检查配置与目录权限后重试\n`);
  process.exitCode = 1;
}
