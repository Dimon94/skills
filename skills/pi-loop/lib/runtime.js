/**
 * pi-loop 运行状态机。
 *
 * L3 职责：循环的创建、派发、结算、暂停恢复与停表，以及状态行文案。
 * L4 依赖：./state.js 的循环形状与结算规则；./schedule.js 的时长格式化；宿主注入的写入口与时钟。
 * L5 导出：createLoopRuntime。
 * L6 状态：内存 loops 是本进程唯一真相；每次结构变化都经 host.appendEntry 追加一条会话条目。
 *    仓库文件不参与。进程重启后按当前分支最后一条条目恢复。
 *
 * 不变量：
 *   - 同一时刻最多一个 inflight（本会话只有一个 agent）。
 *   - 先落盘再派发：fires 先加、状态先写，崩溃最多丢一轮，不会重发。
 *   - 只在会话空闲且无排队消息时派发；忙时 5 秒后再看。
 *   - 每轮结束后从结束时刻起算下一轮，跑超时不连发。
 */

import { formatDuration } from "./schedule.js";
import { MAX_MISSES, STATE_TYPE, createLoop, decodeState, encodeState, resumeLoop, settleLoop } from "./state.js";

const DISPATCH_GRACE_MS = 30 * 1000;
const BUSY_RETRY_MS = 5 * 1000;
const REPORT_LIMIT = 5;

/**
 * @param {object} host
 * @param {(customType: string, data: unknown) => void} host.appendEntry
 * @param {(prompt: string, options: object) => unknown} host.sendUserMessage
 * @param {() => { idle: boolean, busy: boolean }} host.sessionState
 * @param {(text: string, type?: string) => void} host.notify
 * @param {() => void} host.render
 * @param {(filePath: string) => Promise<string>} host.readPrompt
 * @param {{ now: () => number, setTimer: (fn: () => void, ms: number) => unknown, clearTimer: (handle: unknown) => void }} host.clock
 */
export function createLoopRuntime(host) {
	const loops = new Map();
	const reports = [];
	let sequence = 0;
	let inflight = null;
	let timer = null;
	let watchdog = null;
	let attached = false;

	// ------------------------------------------------------------ 基础

	function changed() {
		host.appendEntry(STATE_TYPE, encodeState(loops));
		host.render();
	}

	function report(text, isError = false) {
		reports.push({ text, at: host.clock.now() });
		if (reports.length > REPORT_LIMIT) reports.shift();
		host.notify(`[loop] ${text}`, isError ? "warning" : "info");
	}

	function findByName(name) {
		for (const loop of loops.values()) if (loop.name === name) return loop;
		return null;
	}

	function clearTimer(handle) {
		if (handle !== null) host.clock.clearTimer(handle);
		return null;
	}

	function releaseInflight(loop) {
		if (inflight && inflight.id === loop.id) {
			inflight = null;
			watchdog = clearTimer(watchdog);
		}
	}

	function retire(loop, reason) {
		loops.delete(loop.id);
		releaseInflight(loop);
		report(`${loop.name} 停表：${reason}`);
		changed();
	}

	function pause(loop, reason) {
		releaseInflight(loop);
		loop.paused = true;
		loop.pauseReason = reason;
		loop.status = "idle";
		loop.nextAt = null;
		report(`${loop.name} 已暂停：${reason}。运行 /loop resume ${loop.name} 继续`, true);
		changed();
	}

	// ------------------------------------------------------------ 调度

	function schedule(minDelay = 0) {
		timer = clearTimer(timer);
		host.render();
		if (!attached) return;
		let earliest = Number.POSITIVE_INFINITY;
		for (const loop of loops.values()) {
			if (!loop.paused && loop.status === "idle" && loop.nextAt !== null) earliest = Math.min(earliest, loop.nextAt);
		}
		if (earliest === Number.POSITIVE_INFINITY) return;
		const delay = Math.max(minDelay, earliest - host.clock.now());
		timer = host.clock.setTimer(() => {
			timer = null;
			void tick();
		}, delay);
	}

	async function tick() {
		if (!attached) return;
		const state = host.sessionState();
		if (!state.idle || state.busy || inflight) {
			schedule(BUSY_RETRY_MS);
			return;
		}
		const now = host.clock.now();
		let due = null;
		for (const loop of loops.values()) {
			if (loop.paused || loop.status !== "idle" || loop.nextAt === null || loop.nextAt > now) continue;
			if (!due || loop.nextAt < due.nextAt) due = loop;
		}
		if (due) await dispatch(due);
		schedule();
	}

	async function dispatch(loop) {
		// 先占住 inflight 再读文件：读文件期间别的计时器醒来，也不会派发第二个循环。
		inflight = { id: loop.id, started: false, rescheduledAt: null };
		let prompt = loop.prompt;
		if (loop.promptKind === "file") {
			try {
				prompt = await host.readPrompt(loop.filePath);
			} catch (error) {
				pause(loop, `提示词文件读不了：${error instanceof Error ? error.message : String(error)}`);
				return;
			}
		}
		loop.fires += 1;
		loop.status = "dispatched";
		loop.nextAt = null;
		changed();
		watchdog = host.clock.setTimer(() => {
			watchdog = null;
			if (!inflight || inflight.started || inflight.id !== loop.id) return;
			pause(loop, "消息发出 30 秒内没有开工，可能没配模型、鉴权过期或提示词被别的命令吃掉");
		}, DISPATCH_GRACE_MS);
		try {
			// 只有斜杠提示词走展开；@文件内容即使以 / 开头也按纯文本发送，防止文件内容触发扩展命令。
			await host.sendUserMessage(prompt, { deliverAs: "followUp", expandPromptTemplates: loop.promptKind === "command" });
		} catch (error) {
			pause(loop, `派发失败：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** 一轮结束：只结算由循环派发的那一轮。 */
	function settleRun(aborted) {
		if (!inflight) return;
		const loop = loops.get(inflight.id);
		const { rescheduledAt, started } = inflight;
		if (!started) return;
		inflight = null;
		watchdog = clearTimer(watchdog);
		if (!loop) return;
		if (aborted) {
			pause(loop, "本轮被 Esc 中断");
			return;
		}
		const now = host.clock.now();
		if (loop.mode === "auto" && rescheduledAt === null) {
			loop.misses += 1;
			if (loop.misses >= MAX_MISSES) {
				pause(loop, `连续 ${loop.misses} 轮没调 loop_next，不猜节奏`);
				return;
			}
			report(`${loop.name} 本轮没调 loop_next，按兜底间隔再跑一次`);
		} else {
			loop.misses = 0;
		}
		const settled = settleLoop(loop, now);
		if (settled.stop) {
			retire(loop, settled.stop);
			return;
		}
		loop.status = "idle";
		loop.nextAt = rescheduledAt ?? settled.nextAt;
		changed();
	}

	// ------------------------------------------------------------ 公开面

	return {
		/** 绑定会话：从分支上最后一条状态条目恢复，重算下一轮，起表。 */
		attach(entries) {
			attached = true;
			loops.clear();
			inflight = null;
			let source = null;
			for (const entry of entries) {
				if (entry.type === "custom" && entry.customType === STATE_TYPE) source = entry;
			}
			if (!source) {
				schedule();
				return;
			}
			const decoded = decodeState(source.data);
			if (decoded.error) {
				host.notify(`[loop] 状态条目解不开，不恢复任何循环：${decoded.error}`, "error");
				schedule();
				return;
			}
			sequence = Math.max(sequence, decoded.maxId);
			const dropped = [...decoded.rejected];
			for (const loop of decoded.loops.values()) {
				const resumed = loop.paused ? loop : resumeLoop(loop, host.clock.now());
				if (resumed) loops.set(resumed.id, resumed);
				else dropped.push(`${loop.name}: 已过结束时间或次数`);
			}
			if (dropped.length > 0) host.notify(`[loop] 丢弃 ${dropped.length} 条循环：${dropped.join("；")}`, "warning");
			if (loops.size > 0) host.notify(`[loop] 恢复 ${loops.size} 个循环：${[...loops.values()].map((loop) => loop.name).join("、")}`, "info");
			schedule();
		},

		detach() {
			attached = false;
			timer = clearTimer(timer);
			watchdog = clearTimer(watchdog);
			inflight = null;
		},

		/** 新建并立即跑第一轮（cron 等下一个指针）。 */
		async create(request, name) {
			sequence += 1;
			const loop = createLoop(request, { id: sequence, name, now: host.clock.now() });
			loops.set(loop.id, loop);
			report(`新建 ${loop.name}（${request.display}${loop.mode === "cron" ? "" : "，立即跑第一轮"}）`);
			changed();
			await tick();
			return loop;
		},

		action(name, action) {
			const loop = findByName(name);
			if (!loop) return { error: `没有名为 ${name} 的循环；运行 /loop list 看现有名字` };
			if (action === "stop") {
				retire(loop, "手动停止");
				schedule();
				return { ok: `${name} 已停止` };
			}
			if (action === "pause") {
				if (loop.paused) return { error: `${name} 已是暂停状态` };
				pause(loop, "手动暂停");
				schedule();
				return { ok: `${name} 已暂停` };
			}
			if (action === "resume") {
				if (!loop.paused) return { error: `${name} 不在暂停状态` };
				const resumed = resumeLoop({ ...loop, paused: false, pauseReason: null, misses: 0 }, host.clock.now());
				if (!resumed) {
					retire(loop, "已过结束时间或次数");
					return { error: `${name} 已过结束时间或次数，已停表` };
				}
				loops.set(resumed.id, resumed);
				report(`${name} 已恢复`);
				changed();
				schedule();
				return { ok: `${name} 已恢复` };
			}
			if (action === "run") {
				if (loop.paused) return { error: `${name} 处于暂停状态，先 /loop resume ${name}` };
				if (loop.status === "dispatched") return { error: `${name} 正在跑，等这轮结束` };
				loop.nextAt = host.clock.now();
				report(`${name} 排到下一次空闲时立即跑`);
				changed();
				schedule();
				return { ok: `${name} 排到下一次空闲时立即跑` };
			}
			return { error: `未知动作 ${action}` };
		},

		/** agent_start：确认派发的消息已开工。 */
		markStarted() {
			if (!inflight) return;
			inflight.started = true;
			watchdog = clearTimer(watchdog);
		},

		/** agent_settled：结算本轮并按新指针起表。 */
		settle(aborted) {
			settleRun(aborted);
			schedule();
		},

		/** loop_next：只作用于正在跑的自定节奏循环。delayMs 由调用方限幅。 */
		reschedule(delayMs, stopReason) {
			if (!inflight) return { error: "loop_next 只能在由循环触发的这一轮里调用" };
			const loop = loops.get(inflight.id);
			if (!loop) return { error: "本轮对应的循环已不在" };
			if (loop.mode !== "auto") return { error: `${loop.name} 是${loop.mode === "cron" ? " cron " : "固定间隔"}节奏，不需要 loop_next` };
			if (stopReason) {
				retire(loop, `模型判定结束：${stopReason}`);
				return { ok: `${loop.name} 已停表` };
			}
			inflight.rescheduledAt = host.clock.now() + delayMs;
			return { ok: `${loop.name} 下一轮排到 ${formatDuration(delayMs)} 后` };
		},

		/** 本轮由哪个循环触发；不是循环触发时为 null。 */
		currentLoop() {
			return inflight ? loops.get(inflight.id) ?? null : null;
		},

		list() {
			return [...loops.values()].map((loop) => ({ ...loop }));
		},

		reports() {
			return reports.map((row) => row.text);
		},

		/** 状态行：`loop 2 · ci 4m · sweep 跑`。无循环返回 undefined，清掉状态行。 */
		statusText() {
			if (loops.size === 0) return undefined;
			const now = host.clock.now();
			const parts = [...loops.values()].map((loop) => {
				if (loop.paused) return `${loop.name} 停`;
				if (loop.status === "dispatched") return `${loop.name} 跑`;
				if (loop.nextAt === null) return `${loop.name} 等`;
				return `${loop.name} ${formatDuration(Math.max(0, loop.nextAt - now))}`;
			});
			return `loop ${loops.size} · ${parts.join(" · ")}`;
		},
	};
}
