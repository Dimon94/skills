/**
 * pi-loop /loop 命令语法。
 *
 * L3 职责：把 `/loop` 的参数串解析成新建请求、管理动作或明确的错误。
 * L4 依赖：./schedule.js 的 parseInterval、parseCron、formatDuration；./state.js 的 NAME_PATTERN。
 * L5 导出：parseLoopArgs, deriveName, uniqueName, HELP。
 * L6 状态：无。文件路径在这里只做存在性校验，触发时再读内容。
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { formatDuration, parseCron, parseInterval } from "./schedule.js";
import { NAME_PATTERN } from "./state.js";

export const HELP = `用法：
  /loop auto [--name=X] [--max=N] [--until=2h] <提示词>   模型自己定节奏，每轮用 loop_next 安排下次
  /loop <间隔> [选项] <提示词>                          固定间隔，5m、90s、1h30m、1d
  /loop cron <分 时 日 月 周> [选项] <提示词>            本地时间表点，如 cron 0 9 * * 1-5
  /loop list | /loop stop <名> | /loop pause <名> | /loop resume <名> | /loop run <名>

选项：
  --name=X     名字，只允许小写字母、数字、下划线、短横线，最长 32
  --max=N      最多触发 N 次后自动停
  --until=2h   从现在起 2h 后停止，写法同间隔

提示词：
  纯文本        原样发送
  @path         读文件内容发送，触发时重新读
  /skill:name   走 skill 命令展开；只允许 skill 与 prompt 模板，不允许其他扩展命令

状态存在会话记录里，不写仓库文件。新建后立即跑一轮（cron 除外，等指针）。`;

const FLAG_NAMES = { "--name": "name", "--max": "max", "--until": "until" };
const ACTIONS = new Set(["list", "stop", "pause", "resume", "run"]);
const PROMPT_LOOKS_LIKE_INTERVAL = /^[\d.]+[smhd]?$/i;
const INTERVAL_TOKEN = /^\d+[smhd]$/i;

function splitTokens(text) {
	return text.trim().split(/\s+/).filter(Boolean);
}

function parseFlags(tokens) {
	const flags = {};
	let index = 0;
	while (index < tokens.length && tokens[index].startsWith("--")) {
		const token = tokens[index];
		if (token === "--") return { flags, rest: tokens.slice(index + 1) };
		const eq = token.indexOf("=");
		const key = eq === -1 ? token : token.slice(0, eq);
		const value = eq === -1 ? undefined : token.slice(eq + 1);
		const field = FLAG_NAMES[key];
		if (!field) return { error: `未知选项 ${key}；只有 --name --max --until` };
		if (value === undefined || value === "") return { error: `选项 ${key} 要写成 ${key}=值` };
		if (flags[field] !== undefined) return { error: `选项 ${key} 重复` };
		flags[field] = value;
		index++;
	}
	return { flags, rest: tokens.slice(index) };
}

function normalizeUnits(text) {
	return text.replace(/(\d)\s*([smhd])/gi, "$1$2");
}

/** 把开头连续的间隔片段合并成一个：`1h 30m` 与 `1h30m` 等价。 */
function takeInterval(tokens) {
	const parts = [];
	let index = 0;
	while (index < tokens.length && INTERVAL_TOKEN.test(tokens[index])) {
		parts.push(tokens[index].toLowerCase());
		index++;
	}
	return { text: parts.join(""), rest: tokens.slice(index) };
}

/**
 * 解析 `/loop` 后面的参数。
 * 返回 { kind: "list" } | { kind: "action", action, name } | { kind: "create", request } | { error }。
 */
export function parseLoopArgs(argsText, { cwd = process.cwd(), now = Date.now() } = {}) {
	const tokens = splitTokens(argsText ?? "");
	if (tokens.length === 0) return { kind: "list" };

	const head = tokens[0].toLowerCase();
	if (head === "help" || head === "-h") return { kind: "help" };
	if (ACTIONS.has(head)) {
		if (head === "list") {
			if (tokens.length > 1) return { error: "/loop list 不接受参数" };
			return { kind: "list" };
		}
		if (tokens.length > 2) return { error: `/loop ${head} 只接受一个名字` };
		if (tokens.length < 2) return { error: `/loop ${head} 要跟名字；运行 /loop list 看现有名字` };
		return { kind: "action", action: head, name: tokens[1] };
	}

	const head1 = parseFlags(tokens);
	if (head1.error) return { error: head1.error };
	const flags = { ...head1.flags };
	const rest = normalizeUnits(head1.rest.join(" ")).split(/\s+/).filter(Boolean);

	// 先定节奏；节奏后可再跟选项（`/loop 5m --max=3 检查`），选项后全部是提示词。
	let mode;
	let everyMs;
	let cron;
	let tail;
	const scheduleHead = rest[0]?.toLowerCase();
	if (rest.length === 0) {
		return { error: "缺节奏和提示词；/loop help 看用法" };
	}
	if (scheduleHead === "auto") {
		mode = "auto";
		tail = rest.slice(1);
	} else if (scheduleHead === "cron") {
		const cronText = rest.slice(1, 6).join(" ");
		const cronParsed = parseCron(cronText);
		if (cronParsed.error) return { error: cronParsed.error };
		mode = "cron";
		cron = cronParsed.cron;
		tail = rest.slice(6);
	} else {
		const taken = takeInterval(rest);
		const interval = parseInterval(taken.text);
		if (interval.error) {
			if (PROMPT_LOOKS_LIKE_INTERVAL.test(scheduleHead)) return { error: interval.error };
			return {
				error: `第一个词 ${rest[0]} 既不是节奏也不是子命令。要固定间隔写 5m，要模型定节奏写 auto，要时间表写 cron`,
			};
		}
		mode = "interval";
		everyMs = interval.ms;
		tail = taken.rest;
	}

	const head2 = parseFlags(tail);
	if (head2.error) return { error: head2.error };
	for (const [key, value] of Object.entries(head2.flags)) {
		if (flags[key] !== undefined) return { error: `选项 --${key} 重复` };
		flags[key] = value;
	}
	const prompt = head2.rest.join(" ").trim();
	if (!prompt) return { error: "缺提示词" };

	if (flags.name !== undefined && !NAME_PATTERN.test(flags.name)) {
		return { error: `名字 ${flags.name} 不合规：小写字母开头，只含小写字母、数字、下划线、短横线，最长 32` };
	}
	let maxFires;
	if (flags.max !== undefined) {
		if (!/^\d+$/.test(flags.max) || Number(flags.max) < 1) return { error: `--max 要正整数，收到 ${flags.max}` };
		maxFires = Number(flags.max);
	}
	let expiresAt;
	if (flags.until !== undefined) {
		const until = parseInterval(flags.until);
		if (until.error) return { error: `--until 要用间隔写法：${until.error}` };
		expiresAt = now + until.ms;
	}

	const resolved = resolvePrompt(prompt, cwd);
	if (resolved.error) return { error: resolved.error };

	return {
		kind: "create",
		request: {
			name: flags.name,
			mode,
			everyMs,
			cron,
			maxFires,
			expiresAt,
			prompt: resolved.prompt,
			promptKind: resolved.promptKind,
			filePath: resolved.filePath,
			display: describeSchedule({ mode, everyMs, cron }),
		},
	};
}

/** 提示词形式：纯文本、@文件、/skill: 或 /模板。斜杠形式在这里只记来源，展开交给 pi。 */
function resolvePrompt(prompt, cwd) {
	if (prompt.startsWith("@")) {
		const [rawPath, ...rest] = prompt.split(/\s+/);
		const filePath = isAbsolute(rawPath.slice(1)) ? rawPath.slice(1) : resolve(cwd, rawPath.slice(1));
		if (!existsSync(filePath)) return { error: `提示词文件不存在：${filePath}` };
		return { prompt: prompt, promptKind: "file", filePath };
	}
	if (prompt.startsWith("/")) {
		return { prompt, promptKind: "command" };
	}
	return { prompt, promptKind: "text" };
}

function describeSchedule(loop) {
	if (loop.mode === "interval") return `每 ${formatDuration(loop.everyMs)}`;
	if (loop.mode === "cron") return `cron ${loop.cron.text}`;
	return "自定节奏";
}

/** 从提示词派生名字：skill 名、文件名、首个 ASCII 词，最后回退 loop。 */
export function deriveName(request) {
	let base = "";
	if (request.promptKind === "command" && request.prompt.startsWith("/skill:")) {
		base = request.prompt.slice(7).split(/\s+/)[0] ?? "";
	} else if (request.promptKind === "file" && request.filePath) {
		base = request.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
	} else {
		base = request.prompt.match(/[A-Za-z][A-Za-z0-9_-]{1,31}/)?.[0] ?? "";
	}
	const slug = base
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "")
		.slice(0, 32);
	if (!NAME_PATTERN.test(slug)) return "loop";
	return slug;
}

/** 同名时加 -2、-3 后缀，最长 32。 */
export function uniqueName(base, taken) {
	if (!taken.has(base)) return base;
	for (let index = 2; index < 1000; index++) {
		const suffix = `-${index}`;
		const candidate = base.slice(0, 32 - suffix.length) + suffix;
		if (!taken.has(candidate)) return candidate;
	}
	return base;
}
