/**
 * pi-loop 循环状态。
 *
 * L3 职责：循环对象的形状、严格解码、一轮结束后的下一轮时刻与恢复归位。
 * L4 依赖：./schedule.js 的 nextAfterSettle、nextCronAt 与间隔上下限。
 * L5 导出：NAME_PATTERN, STATE_TYPE, STATE_VERSION, FALLBACK_MS, DEFAULT_LIFETIME_MS, MAX_MISSES,
 *          createLoop, decodeLoop, decodeState, encodeState, settleLoop, resumeLoop。
 * L6 状态：只生产与校验数据，不写盘。持久化由 ./runtime.js 追加会话条目。
 */

import { MAX_EVERY_MS, MIN_EVERY_MS, nextAfterSettle, nextCronAt } from "./schedule.js";

/** 循环名：小写字母开头，最长 32。 */
export const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const STATE_TYPE = "pi-loop-state";
export const STATE_VERSION = 1;
/** 自定节奏本轮没调 loop_next 时的兜底间隔。 */
export const FALLBACK_MS = 20 * 60 * 1000;
/** 自定节奏连续漏排这么多次就暂停。 */
export const MAX_MISSES = 2;
/** 未写 --until 时的存活期。 */
export const DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const MODES = new Set(["interval", "cron", "auto"]);
const PROMPT_KINDS = new Set(["text", "file", "command"]);
const STATUSES = new Set(["idle", "dispatched"]);
const CRON_SETS = [
	["minutes", 0, 59],
	["hours", 0, 23],
	["daysOfMonth", 1, 31],
	["months", 1, 12],
	["daysOfWeek", 0, 7],
];

const isTime = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const isCount = (value) => Number.isInteger(value) && value >= 0;

// ---------------------------------------------------------------- 编解码

function encodeLoop(loop) {
	const out = { ...loop };
	if (loop.cron) {
		out.cron = { ...loop.cron };
		for (const [key] of CRON_SETS) out.cron[key] = [...loop.cron[key]].sort((a, b) => a - b);
	}
	return out;
}

export function encodeState(loops) {
	return { version: STATE_VERSION, loops: [...loops.values()].map(encodeLoop) };
}

function decodeCron(value) {
	if (!value || typeof value !== "object" || typeof value.text !== "string" || !value.text) return { error: "cron 缺失" };
	const cron = { text: value.text, domRestricted: value.domRestricted === true, dowRestricted: value.dowRestricted === true };
	for (const [key, min, max] of CRON_SETS) {
		const list = value[key];
		if (!Array.isArray(list) || list.length === 0) return { error: `cron.${key} 必须是非空数组` };
		if (!list.every((item) => Number.isInteger(item) && item >= min && item <= max)) return { error: `cron.${key} 越界` };
		cron[key] = new Set(list);
	}
	return { cron };
}

/** 逐字段校验一条循环；任何字段不对就拒收整条，不做部分修补。 */
export function decodeLoop(value) {
	if (!value || typeof value !== "object") return { error: "不是对象" };
	const { id, name, prompt, promptKind, filePath, mode, status, fires, misses, createdAt, expiresAt, maxFires, nextAt } = value;
	if (!Number.isInteger(id) || id < 1) return { error: "id 非法" };
	if (typeof name !== "string" || !NAME_PATTERN.test(name)) return { error: "name 非法" };
	if (typeof prompt !== "string" || !prompt.trim()) return { error: "prompt 为空" };
	if (!PROMPT_KINDS.has(promptKind)) return { error: "promptKind 非法" };
	if (promptKind === "file" && (typeof filePath !== "string" || !filePath)) return { error: "filePath 缺失" };
	if (!MODES.has(mode)) return { error: "mode 非法" };
	if (!STATUSES.has(status)) return { error: "status 非法" };
	if (!isCount(fires) || !isCount(misses)) return { error: "计数非法" };
	if (!isTime(createdAt) || !isTime(expiresAt)) return { error: "时间非法" };
	if (maxFires !== null && (!Number.isInteger(maxFires) || maxFires < 1)) return { error: "maxFires 非法" };
	if (nextAt !== null && !isTime(nextAt)) return { error: "nextAt 非法" };

	const loop = {
		id,
		name,
		prompt,
		promptKind,
		filePath: promptKind === "file" ? filePath : null,
		mode,
		status,
		fires,
		misses,
		createdAt,
		expiresAt,
		maxFires,
		nextAt,
		paused: value.paused === true,
		pauseReason: value.paused === true && typeof value.pauseReason === "string" ? value.pauseReason : null,
	};
	if (mode === "interval") {
		if (!Number.isFinite(value.everyMs) || value.everyMs < MIN_EVERY_MS || value.everyMs > MAX_EVERY_MS) {
			return { error: "everyMs 越界" };
		}
		loop.everyMs = value.everyMs;
	}
	if (mode === "cron") {
		const decoded = decodeCron(value.cron);
		if (decoded.error) return decoded;
		loop.cron = decoded.cron;
	}
	return { loop };
}

/**
 * 解码会话条目。整体结构不对返回 { error }；单条坏掉只丢那一条并记入 rejected。
 * maxId 覆盖被拒的条目，新循环不复用它们的 id。
 */
export function decodeState(data) {
	if (!data || typeof data !== "object") return { error: "状态不是对象" };
	if (data.version !== STATE_VERSION) return { error: `状态版本 ${String(data.version)} 不是 ${STATE_VERSION}` };
	if (!Array.isArray(data.loops)) return { error: "loops 不是数组" };
	const loops = new Map();
	const names = new Set();
	const rejected = [];
	let maxId = 0;
	for (const raw of data.loops) {
		if (Number.isInteger(raw?.id)) maxId = Math.max(maxId, raw.id);
		const label = typeof raw?.name === "string" ? raw.name : `#${String(raw?.id ?? "?")}`;
		const decoded = decodeLoop(raw);
		if (decoded.error) {
			rejected.push(`${label}: ${decoded.error}`);
			continue;
		}
		if (loops.has(decoded.loop.id) || names.has(decoded.loop.name)) {
			rejected.push(`${label}: id 或名字重复`);
			continue;
		}
		loops.set(decoded.loop.id, decoded.loop);
		names.add(decoded.loop.name);
	}
	return { loops, rejected, maxId };
}

// ---------------------------------------------------------------- 生命周期

/** 新循环：间隔与自定节奏立即可跑；cron 等第一个指针。 */
export function createLoop(request, { id, name, now }) {
	const loop = {
		id,
		name,
		prompt: request.prompt,
		promptKind: request.promptKind,
		filePath: request.filePath ?? null,
		mode: request.mode,
		status: "idle",
		fires: 0,
		misses: 0,
		createdAt: now,
		expiresAt: request.expiresAt ?? now + DEFAULT_LIFETIME_MS,
		maxFires: request.maxFires ?? null,
		nextAt: request.mode === "cron" ? nextCronAt(request.cron, now) : now,
		paused: false,
		pauseReason: null,
	};
	if (request.mode === "interval") loop.everyMs = request.everyMs;
	if (request.mode === "cron") loop.cron = request.cron;
	return loop;
}

/**
 * 一轮结束后的下一轮。返回 { nextAt } 或 { stop: 原因 }。
 * 判定顺序：--max、cron 无匹配、--until。
 */
export function settleLoop(loop, settledAt) {
	if (loop.maxFires !== null && loop.fires >= loop.maxFires) return { stop: `已跑满 --max ${loop.maxFires} 次` };
	const nextAt = nextAfterSettle(loop, settledAt, FALLBACK_MS);
	if (nextAt === null) return { stop: "cron 一年内没有下一次匹配" };
	if (nextAt > loop.expiresAt) return { stop: "到达结束时间" };
	return { nextAt };
}

/**
 * 恢复归位。未到点的空闲循环保留原指针；中断的、过点的、暂停后恢复的，从当前时刻起算一个周期。
 * 不追补停机期间错过的轮次，也不立即补跑，避免重启后连发。
 */
export function resumeLoop(loop, now) {
	if (loop.status === "idle" && loop.nextAt !== null && loop.nextAt > now) return { ...loop };
	const settled = settleLoop(loop, now);
	if (settled.stop) return null;
	return { ...loop, status: "idle", nextAt: settled.nextAt };
}
