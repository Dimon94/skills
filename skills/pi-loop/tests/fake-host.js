/**
 * 测试替身：假的 pi 宿主与可控时钟。
 * 只实现被测代码真正调用的面：appendEntry、sendUserMessage、sendMessage、notify、render、readPrompt、clock。
 */

export const HOME = "/tmp/pi-loop-home";
export const CWD = "/tmp/pi-loop-cwd";

export function createClock(start = 1_800_000_000_000) {
	let now = start;
	let nextId = 1;
	const timers = new Map();
	return {
		now: () => now,
		setTimer: (fn, ms) => {
			const id = nextId++;
			timers.set(id, { at: now + Math.max(0, ms), fn });
			return id;
		},
		clearTimer: (id) => {
			timers.delete(id);
		},
		get pending() {
			return [...timers.values()].map((timer) => timer.at - now).sort((a, b) => a - b);
		},
		/** 时间前进，按到期顺序只跑到 at <= 目标时刻的定时器一次。 */
		advance(ms) {
			const target = now + ms;
			for (;;) {
				const due = [...timers.entries()]
					.filter(([, timer]) => timer.at <= target)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				const [id, timer] = due;
				timers.delete(id);
				now = timer.at;
				timer.fn();
			}
			now = target;
		},
	};
}

export function createHost(clock, overrides = {}) {
	const hooks = { onSend: null };
	const sent = [];
	const entries = [];
	const notices = [];
	let renders = 0;
	const state = { idle: true, busy: false };

	const host = {
		sent,
		entries,
		notices,
		state,
		get renders() {
			return renders;
		},
		appendEntry: (customType, data) => {
			entries.push({ type: "custom", customType, data: JSON.parse(JSON.stringify(data)) });
		},
		hooks,
		sendUserMessage: (prompt, options) => {
			sent.push({ prompt, options });
			state.idle = false;
			state.busy = true;
			// 真实 pi 在消息送达后立刻 agent_start；这里由 onSend 模拟。
			hooks.onSend?.();
		},
		sendMessage: () => {},
		notify: (text, type) => {
			notices.push({ text, type });
		},
		render: () => {
			renders += 1;
		},
		sessionState: () => ({ idle: state.idle, busy: state.busy }),
		readPrompt: async (path) => {
			if (path.endsWith("missing.md")) throw new Error("ENOENT");
			return `file:${path}`;
		},
		clock,
		...overrides,
	};
	return host;
}

/** 模拟一轮结束：宿主恢复空闲，再由调用方触发 runtime.settle。 */
export function finishRun(host) {
	host.state.idle = true;
	host.state.busy = false;
}
