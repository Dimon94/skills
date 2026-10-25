/**
 * pi-loop 的 pi 接入层。
 *
 * L3 职责：注册 /loop 命令与 loop_next、loop_status 工具；把 pi 生命周期事件转给运行状态机；
 *          维护状态行；校验斜杠提示词。
 * L4 依赖：./command.js 的命令语法；./runtime.js 的状态机；宿主 pi（ExtensionAPI）与宿主提供的 typebox。
 * L5 导出：default function register(pi)。
 * L6 状态：运行期状态在 runtime 内存中，持久化为会话条目 `pi-loop-state`。不写仓库文件，不碰全局配置。
 *
 * 边界：只在 TUI 会话里调度。print/json/rpc 模式与子 agent 会话不恢复也不触发循环。
 */

import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { HELP, deriveName, parseLoopArgs, uniqueName } from "./command.js";
import { createLoopRuntime } from "./runtime.js";
import { formatDuration, parseInterval } from "./schedule.js";

const STATUS_KEY = "pi-loop";
const STATUS_REFRESH_MS = 30 * 1000;
const TIMER_SLICE_MS = 60 * 1000;
const NEXT_MIN_MS = 60 * 1000;
const NEXT_MAX_MS = 24 * 60 * 60 * 1000;
const PROMPT_FILE_LIMIT = 64 * 1024;
const MODE_LABEL = { interval: "固定间隔", cron: "cron", auto: "自定节奏" };

/**
 * loop_next 的 delay：纯数字按秒，或 15m、2h 写法。限幅 [60s, 24h]，越界报错，不静默改值。
 * reason 非空时表示结束循环，忽略 delay。
 */
function parseNextArgs(args) {
	const reason = typeof args.reason === "string" ? args.reason.trim() : "";
	if (reason) return { stop: reason };
	const text = String(args.delay ?? "").trim();
	if (!text) return { error: "要么给 delay（60 到 86400 秒，或 15m、2h 写法），要么给 reason 结束循环" };
	const parsed = /^\d+$/.test(text) ? { ms: Number(text) * 1000 } : parseInterval(text);
	if (parsed.error) return { error: `delay 要用秒数或 15m、2h 这样的写法，收到 ${text}` };
	if (parsed.ms < NEXT_MIN_MS) return { error: `delay 最短 60 秒，收到 ${formatDuration(parsed.ms)}` };
	if (parsed.ms > NEXT_MAX_MS) return { error: `delay 最长 1 天，收到 ${formatDuration(parsed.ms)}` };
	return { ms: parsed.ms };
}

function describeLoops(runtime) {
	const rows = runtime.list();
	if (rows.length === 0) return "当前没有循环。用 /loop 5m <提示词> 或 /loop auto <提示词> 新建；/loop help 看用法。";
	const now = Date.now();
	const lines = rows.map((row) => {
		let state = "待触发";
		if (row.paused) state = `暂停（${row.pauseReason ?? "手动"}）`;
		else if (row.status === "dispatched") state = "本轮进行中";
		else if (row.nextAt) state = `下一轮 ${formatDuration(Math.max(0, row.nextAt - now))} 后`;
		return `- ${row.name} · ${MODE_LABEL[row.mode]} · 已跑 ${row.fires} 次 · ${state}`;
	});
	const reports = runtime.reports();
	if (reports.length > 0) lines.push("", "最近事件：", ...reports.map((text) => `- ${text}`));
	return lines.join("\n");
}

/**
 * 斜杠提示词只允许 skill 与 prompt 模板。扩展命令会绕开模型直接执行，可能自我派生循环，禁止。
 * skill 找不到时当场报错，不让拼错的名字每轮把原文发给模型。
 */
function rejectCommandPrompt(pi, prompt) {
	if (!prompt.startsWith("/")) return null;
	const name = prompt.slice(1).split(/\s+/)[0];
	const command = pi.getCommands().find((entry) => entry.name === name);
	if (name.startsWith("skill:") && !command) {
		return `找不到 skill ${name.slice(6)}。pi 只发现 ~/.agents/skills、.agents/skills、.pi/skills 下的 skill`;
	}
	if (command?.source === "extension") return `不能把扩展命令 /${name} 作为循环提示词；用 /skill:name 或 prompt 模板`;
	return null;
}

function textResult(text, isError = false) {
	return { content: [{ type: "text", text }], isError };
}

export default function register(pi) {
	let ctx = null;
	let refresh = null;

	const showStatus = () => ctx?.ui.setStatus(STATUS_KEY, runtime.statusText());

	const runtime = createLoopRuntime({
		appendEntry: (customType, data) => pi.appendEntry(customType, data),
		sendUserMessage: (prompt, options) => pi.sendUserMessage(prompt, options),
		sessionState: () => ({ idle: ctx?.isIdle() ?? false, busy: ctx?.hasPendingMessages() ?? true }),
		notify: (text, type) => ctx?.ui.notify(text, type),
		render: showStatus,
		readPrompt: async (filePath) => {
			const text = await readFile(filePath, "utf8");
			if (!text.trim()) throw new Error("文件为空");
			if (text.length > PROMPT_FILE_LIMIT) throw new Error("文件超过 64KB");
			return text;
		},
		clock: {
			now: () => Date.now(),
			// 长等待切成 60 秒一片，每片醒来用当前时间重算：休眠、改时间后不漂。
			setTimer: (fn, ms) => {
				const handle = setTimeout(fn, Math.min(Math.max(0, ms), TIMER_SLICE_MS));
				handle.unref?.();
				return handle;
			},
			clearTimer: (handle) => clearTimeout(handle),
		},
	});

	function bind(nextCtx) {
		ctx = nextCtx;
		runtime.detach();
		runtime.attach(ctx.sessionManager.getBranch());
		if (refresh === null) {
			refresh = setInterval(showStatus, STATUS_REFRESH_MS);
			refresh.unref?.();
		}
	}

	function unbind() {
		runtime.detach();
		if (refresh !== null) clearInterval(refresh);
		refresh = null;
		ctx = null;
	}

	pi.registerCommand("loop", {
		description: "按节奏重复同一件事：/loop 5m <提示词> · /loop auto <提示词> · /loop cron 0 9 * * 1-5 <提示词> · /loop help",
		handler: async (args, commandCtx) => {
			if (commandCtx.mode !== "tui") {
				const text = `pi-loop：/loop 只能在 pi 交互会话（TUI）里用，当前是 ${commandCtx.mode} 模式。不带 -p、--mode 启动 pi 后再输入`;
				// print、json 模式没有通知通道：写 stderr，不污染 stdout 上的输出合同。
				if (commandCtx.hasUI) commandCtx.ui.notify(text, "error");
				else process.stderr.write(`${text}\n`);
				return;
			}
			ctx = commandCtx;
			const parsed = parseLoopArgs(args, { cwd: commandCtx.cwd });
			if (parsed.error) return commandCtx.ui.notify(parsed.error, "error");
			if (parsed.kind === "help") return commandCtx.ui.notify(HELP, "info");
			if (parsed.kind === "list") return commandCtx.ui.notify(describeLoops(runtime), "info");
			if (parsed.kind === "action") {
				// 成功由 runtime 的事件通知报告，这里只报错误，避免同一件事提示两次。
				const result = runtime.action(parsed.name, parsed.action);
				if (result.error) commandCtx.ui.notify(result.error, "error");
				return;
			}
			const rejection = rejectCommandPrompt(pi, parsed.request.prompt);
			if (rejection) return commandCtx.ui.notify(rejection, "error");
			const taken = new Set(runtime.list().map((row) => row.name));
			await runtime.create(parsed.request, uniqueName(parsed.request.name ?? deriveName(parsed.request), taken));
		},
	});

	pi.registerTool({
		name: "loop_next",
		label: "loop next",
		description:
			"安排本循环的下一轮，或结束本循环。只在 /loop auto 触发的这一轮里有效。delay 与 reason 二选一：delay 是等多久再跑（纯数字按秒，60 到 86400；也接受 15m、2h）；reason 表示这件事不用再查了，写一句理由。",
		parameters: Type.Object(
			{
				delay: Type.Optional(Type.String({ description: "等多久再跑下一轮：秒数，或 15m、2h 写法" })),
				reason: Type.Optional(Type.String({ description: "结束循环的理由；填了就不再安排下一轮" })),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, args) {
			const parsed = parseNextArgs(args ?? {});
			if (parsed.error) return textResult(parsed.error, true);
			const result = parsed.stop ? runtime.reschedule(0, parsed.stop) : runtime.reschedule(parsed.ms, null);
			return result.error ? textResult(result.error, true) : textResult(result.ok);
		},
	});

	pi.registerTool({
		name: "loop_status",
		label: "loop status",
		description: "列出本会话的循环：节奏、已跑次数、下一次触发时间与最近事件。排查循环为什么没动静时先调它。",
		parameters: Type.Object({}, { additionalProperties: false }),
		async execute() {
			return textResult(describeLoops(runtime));
		},
	});

	pi.on("session_start", (_event, eventCtx) => {
		if (eventCtx.mode === "tui") bind(eventCtx);
	});

	// /tree 换分支后，以新分支上最后一条状态条目为准。
	pi.on("session_tree", (_event, eventCtx) => {
		if (eventCtx.mode === "tui") bind(eventCtx);
	});

	pi.on("agent_start", () => runtime.markStarted());

	pi.on("agent_settled", (event) => runtime.settle(event.aborted === true));

	// 告诉模型这一轮由哪个循环触发、要不要调 loop_next。进本轮上下文，不在界面显示。
	pi.on("before_agent_start", () => {
		const loop = runtime.currentLoop();
		if (!loop) return undefined;
		const pacing =
			loop.mode === "auto"
				? "本轮结束前必须调用 loop_next：还要继续就给 delay（60 到 86400 秒），不用再查就给 reason。"
				: `节奏由${loop.mode === "cron" ? " cron 时间表" : "固定间隔"}控制，不要调用 loop_next。`;
		return {
			message: {
				customType: "pi-loop-guidance",
				content: `[pi-loop] 这一轮由循环「${loop.name}」第 ${loop.fires} 次触发。${pacing}`,
				display: false,
			},
		};
	});

	pi.on("session_shutdown", unbind);
}
