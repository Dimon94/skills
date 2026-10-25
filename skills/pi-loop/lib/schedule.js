/**
 * pi-loop 节奏计算。
 *
 * L3 职责：把用户写的间隔、cron 表达式和自定节奏，确定性地换算成下一次触发时刻。
 * L4 依赖：无。纯函数，时间由调用方传入，不读系统时钟。
 * L5 导出：parseInterval, formatDuration, parseCron, nextCronAt, nextAfterSettle。
 * L6 状态：无。
 */

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const MIN_EVERY_MS = MIN;
export const MAX_EVERY_MS = DAY;

const UNIT_MS = { s: SEC, m: MIN, h: HOUR, d: DAY };
const INTERVAL_PART = /(\d+)([smhd])/g;

/**
 * 解析间隔写法：`90s`、`5m`、`1h30m`、`2h`、`1d`。单位必须从大到小排列。
 * 返回毫秒；格式不对或超出 [1 分钟, 1 天] 返回 { error }。
 */
export function parseInterval(text) {
	const raw = String(text ?? "").trim().toLowerCase();
	if (!raw) return { error: "间隔为空" };
	if (!/^(\d+[smhd])+$/.test(raw)) {
		return { error: `间隔格式不对：${text}。用 5m、90s、1h30m、1d` };
	}
	let total = 0;
	let lastUnitMs = Number.POSITIVE_INFINITY;
	INTERVAL_PART.lastIndex = 0;
	for (const match of raw.matchAll(INTERVAL_PART)) {
		const [, digits, unit] = match;
		const unitMs = UNIT_MS[unit];
		if (unitMs >= lastUnitMs) return { error: `间隔单位要按天、时、分、秒从大到小写：${text}` };
		lastUnitMs = unitMs;
		total += Number(digits) * unitMs;
	}
	if (total < MIN_EVERY_MS) return { error: "最短间隔 1m" };
	if (total > MAX_EVERY_MS) return { error: "最长间隔 1d；更稀疏的节奏用 cron" };
	return { ms: total };
}

/** 毫秒转短文本：`45s`、`5m`、`1h30m`、`2d3h`。 */
export function formatDuration(ms) {
	// 先取整到秒再分档：59.6s 进位成 1m，不显示 60s。
	const value = Math.max(0, Math.round((Number(ms) || 0) / SEC) * SEC);
	if (value < MIN) return `${value / SEC}s`;
	const days = Math.floor(value / DAY);
	const hours = Math.floor((value % DAY) / HOUR);
	const minutes = Math.floor((value % HOUR) / MIN);
	const parts = [];
	if (days) parts.push(`${days}d`);
	if (hours) parts.push(`${hours}h`);
	if (minutes && !days) parts.push(`${minutes}m`);
	if (parts.length === 0) parts.push("0m");
	return parts.join("");
}

// ---------------------------------------------------------------- cron

const CRON_FIELDS = [
	{ name: "分", min: 0, max: 59 },
	{ name: "时", min: 0, max: 23 },
	{ name: "日", min: 1, max: 31 },
	{ name: "月", min: 1, max: 12 },
	{ name: "周", min: 0, max: 7 },
];
const CRON_SCAN_DAYS = 366;

function parseCronField(spec, field) {
	const values = new Set();
	for (const piece of String(spec).split(",")) {
		if (!piece) return { error: `${field.name}字段有空项：${spec}` };
		const [rangeText, stepText, extra] = piece.split("/");
		if (extra !== undefined) return { error: `${field.name}字段步长写法错：${piece}` };
		let step = 1;
		if (stepText !== undefined) {
			if (!/^\d+$/.test(stepText) || Number(stepText) === 0) {
				return { error: `${field.name}字段步长要正整数：${piece}` };
			}
			step = Number(stepText);
		}
		let low;
		let high;
		if (rangeText === "*") {
			low = field.min;
			high = field.max;
		} else if (/^\d+$/.test(rangeText)) {
			low = Number(rangeText);
			high = stepText === undefined ? low : field.max;
		} else {
			const bounds = rangeText.split("-");
			if (bounds.length !== 2 || !bounds.every((n) => /^\d+$/.test(n))) {
				return { error: `${field.name}字段无法解析：${piece}` };
			}
			low = Number(bounds[0]);
			high = Number(bounds[1]);
		}
		if (low < field.min || high > field.max || low > high) {
			return { error: `${field.name}字段超出 ${field.min}-${field.max}：${piece}` };
		}
		for (let value = low; value <= high; value += step) values.add(value);
	}
	if (field.name === "周" && values.has(7)) values.add(0);
	return { values };
}

/**
 * 解析 5 字段 cron（分 时 日 月 周），本地时间。
 * 支持星号、单值、范围、步长（斜杠写法）与逗号列表；周 0 和 7 都是周日。
 * 不支持月和周的英文缩写。
 */
export function parseCron(text) {
	const fields = String(text ?? "")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (fields.length !== 5) return { error: `cron 要 5 个字段（分 时 日 月 周），收到 ${fields.length} 个` };
	const sets = [];
	for (let i = 0; i < 5; i++) {
		const parsed = parseCronField(fields[i], CRON_FIELDS[i]);
		if (parsed.error) return { error: parsed.error };
		sets.push(parsed.values);
	}
	const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets;
	return {
		cron: {
			text: fields.join(" "),
			minutes,
			hours,
			daysOfMonth,
			months,
			daysOfWeek,
			// 日和周都受限时取并集，与 crontab 一致。
			domRestricted: fields[2] !== "*",
			dowRestricted: fields[4] !== "*",
		},
	};
}

function cronDayMatches(cron, date) {
	if (!cron.months.has(date.getMonth() + 1)) return false;
	const domMatch = cron.daysOfMonth.has(date.getDate());
	const dowMatch = cron.daysOfWeek.has(date.getDay());
	if (cron.domRestricted && cron.dowRestricted) return domMatch || dowMatch;
	if (cron.domRestricted) return domMatch;
	if (cron.dowRestricted) return dowMatch;
	return true;
}

/**
 * 求第一个严格晚于 after 的匹配时刻（本地时间）。
 * 一年内无匹配返回 null。
 */
export function nextCronAt(cron, after) {
	const start = new Date(after);
	start.setSeconds(0, 0);
	start.setMinutes(start.getMinutes() + 1);
	for (let offset = 0; offset <= CRON_SCAN_DAYS; offset++) {
		const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
		if (!cronDayMatches(cron, day)) continue;
		for (let hour = offset === 0 ? start.getHours() : 0; hour < 24; hour++) {
			if (!cron.hours.has(hour)) continue;
			for (let minute = offset === 0 && hour === start.getHours() ? start.getMinutes() : 0; minute < 60; minute++) {
				if (!cron.minutes.has(minute)) continue;
				return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).getTime();
			}
		}
	}
	return null;
}

/**
 * 一轮结束后的下一次时刻。固定间隔与自定节奏从结束时刻起算，不按墙上时钟对齐，跑超时也不连发。
 * cron 一年内无匹配返回 null，由调用方停表。
 */
export function nextAfterSettle(loop, settledAt, fallbackMs) {
	if (loop.mode === "interval") return settledAt + loop.everyMs;
	if (loop.mode === "cron") return nextCronAt(loop.cron, settledAt);
	return settledAt + fallbackMs;
}
