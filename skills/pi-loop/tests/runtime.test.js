/**
 * 状态机测试：只走 createLoopRuntime 的公开方法，宿主与时钟是替身。
 * 每条测试写明哪种错误实现会让它失败：
 *   1. 新建不立即跑 / 下一轮按墙上时钟对齐 / 忙时也派发。
 *   2. 有排队消息时插队 / 忙完不补跑 / 忙时 0 延迟空转（会卡死测试）。
 *   3. Esc 后继续派发 / 消息没开工却一直占着循环。
 *   4. 不用 loop_next 的时刻 / 漏排后不兜底 / 漏排两次还在猜节奏。
 *   5. 恢复后连发 / 恢复时推迟未到点的循环 / 坏条目污染 / id 复用 / 暂停状态在重启后丢失。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoopRuntime } from "../lib/runtime.js";
import { createClock, createHost, finishRun } from "./fake-host.js";

function setup({ autoStart = true, entries = [] } = {}) {
	const clock = createClock();
	const host = createHost(clock);
	const runtime = createLoopRuntime(host);
	// 真实 pi 在消息送达后触发 agent_start；autoStart=false 模拟“发出去了但没开工”。
	if (autoStart) host.hooks.onSend = () => runtime.markStarted();
	runtime.attach(entries);
	return { clock, host, runtime };
}

/** 一轮跑完：宿主回到空闲，再发 agent_settled。 */
function endRun(host, runtime, aborted = false) {
	finishRun(host);
	runtime.settle(aborted);
}

const only = (runtime) => runtime.list()[0];
const interval = (everyMs) => ({ mode: "interval", everyMs, prompt: "检查 CI", promptKind: "text", display: "固定间隔" });
const auto = () => ({ mode: "auto", prompt: "扫票", promptKind: "text", display: "自定节奏" });

test("新建即跑第一轮；跑超时不连发；下一轮从结束时刻起算", async () => {
	const { clock, host, runtime } = setup();
	await runtime.create(interval(300_000), "ci");
	assert.equal(host.sent.length, 1, "新建应立即派发一轮");
	assert.deepEqual(host.sent[0], { prompt: "检查 CI", options: { deliverAs: "followUp", expandPromptTemplates: false } });

	clock.advance(2_400_000);
	assert.equal(host.sent.length, 1, "本轮没结束，40 分钟里不得再派发");

	endRun(host, runtime);
	assert.equal(only(runtime).nextAt, clock.now() + 300_000);
	clock.advance(299_999);
	assert.equal(host.sent.length, 1, "未到点不派发");
	clock.advance(1);
	assert.equal(host.sent.length, 2, "到点派发第二轮");
	assert.equal(only(runtime).fires, 2);
});

test("有排队消息时让路，排队清空后下一次重试补跑", async () => {
	const { clock, host, runtime } = setup();
	await runtime.create(interval(300_000), "ci");
	endRun(host, runtime);

	host.state.busy = true;
	clock.advance(300_000);
	assert.equal(host.sent.length, 1, "有排队消息时不能插队");

	host.state.busy = false;
	clock.advance(5_000);
	assert.equal(host.sent.length, 2, "空闲后补跑一次");
});

test("Esc 中断与派发未开工都会暂停，之后不再派发", async () => {
	const esc = setup();
	await esc.runtime.create(interval(300_000), "ci");
	endRun(esc.host, esc.runtime, true);
	assert.equal(only(esc.runtime).paused, true);
	assert.match(only(esc.runtime).pauseReason, /Esc/);
	esc.clock.advance(3_600_000);
	assert.equal(esc.host.sent.length, 1, "暂停后不再派发");

	const stuck = setup({ autoStart: false });
	await stuck.runtime.create(interval(300_000), "ci");
	assert.equal(only(stuck.runtime).paused, false);
	stuck.clock.advance(30_000);
	assert.equal(only(stuck.runtime).paused, true, "30 秒没开工就暂停");
	assert.match(only(stuck.runtime).pauseReason, /没有开工/);
	stuck.clock.advance(3_600_000);
	assert.equal(stuck.host.sent.length, 1);
});

test("自定节奏：采用 loop_next 的时刻；漏一次走兜底；连漏两次暂停", async () => {
	const { clock, host, runtime } = setup();
	await runtime.create(auto(), "sweep");

	assert.equal(runtime.reschedule(900_000, null).ok, "sweep 下一轮排到 15m 后");
	endRun(host, runtime);
	assert.equal(only(runtime).nextAt, clock.now() + 900_000);
	clock.advance(900_000);
	assert.equal(host.sent.length, 2);

	endRun(host, runtime);
	assert.equal(only(runtime).nextAt, clock.now() + 1_200_000, "漏排一次按 20 分钟兜底");
	clock.advance(1_200_000);
	assert.equal(host.sent.length, 3);

	endRun(host, runtime);
	assert.equal(only(runtime).paused, true, "连漏两次暂停");
	assert.match(only(runtime).pauseReason, /loop_next/);
	clock.advance(3_600_000);
	assert.equal(host.sent.length, 3);
});

test("loop_next 的 reason 停表；非循环轮次与固定节奏拒绝调用", async () => {
	const { host, runtime } = setup();
	assert.match(runtime.reschedule(600_000, null).error, /只能在由循环触发/);

	await runtime.create(interval(300_000), "ci");
	assert.match(runtime.reschedule(600_000, null).error, /不需要 loop_next/);
	endRun(host, runtime);

	await runtime.action("ci", "stop");
	await runtime.create(auto(), "sweep");
	assert.equal(runtime.reschedule(0, "票清空了").ok, "sweep 已停表");
	assert.deepEqual(runtime.list(), []);
	assert.equal(runtime.statusText(), undefined, "无循环时清掉状态行");
});

test("恢复：中断的派发按周期重排不连发；坏条目被拒；id 不复用；暂停跨重启保留", async () => {
	const clock = createClock();
	const saved = {
		version: 1,
		loops: [
			{
				id: 7,
				name: "ci",
				prompt: "检查 CI",
				promptKind: "text",
				filePath: null,
				mode: "interval",
				everyMs: 300_000,
				status: "dispatched",
				fires: 4,
				misses: 0,
				createdAt: clock.now() - 3_600_000,
				expiresAt: clock.now() + 3_600_000,
				maxFires: null,
				nextAt: null,
			},
			{ id: 8, name: "broken", prompt: "", mode: "interval", status: "idle" },
			{
				id: 3,
				name: "daily",
				prompt: "日报",
				promptKind: "text",
				filePath: null,
				mode: "interval",
				everyMs: 3_600_000,
				status: "idle",
				fires: 1,
				misses: 0,
				createdAt: clock.now() - 3_480_000,
				expiresAt: clock.now() + 86_400_000,
				maxFires: null,
				nextAt: clock.now() + 120_000,
			},
		],
	};
	const { host, runtime } = setup({ entries: [{ type: "custom", customType: "pi-loop-state", data: saved }] });

	const byName = (name) => runtime.list().find((loop) => loop.name === name);
	assert.equal(runtime.list().length, 2, "坏条目被丢");
	assert.equal(byName("ci").status, "idle");
	assert.equal(byName("ci").fires, 4);
	assert.equal(byName("ci").nextAt, host.clock.now() + 300_000, "中断的一轮从恢复时刻起算一个周期");
	assert.equal(byName("daily").nextAt, host.clock.now() + 120_000, "未到点的空闲循环保留原指针");
	assert.ok(host.notices.some((notice) => /丢弃 1 条/.test(notice.text)));
	assert.equal(host.sent.length, 0, "恢复不立即补跑");
	host.clock.advance(120_000);
	assert.deepEqual(host.sent.map((row) => row.prompt), ["日报"], "原指针到点照常触发");
	endRun(host, runtime);
	assert.equal((await runtime.create({ ...interval(300_000), prompt: "另一件事" }, "next")).id, 9, "id 越过被拒条目");

	// 暂停后用同一份会话条目重建，仍是暂停、不派发。
	runtime.action("ci", "pause");
	const restarted = setup({ entries: host.entries });
	assert.equal(restarted.runtime.list().find((loop) => loop.name === "ci").paused, true);
	restarted.clock.advance(3_600_000);
	assert.equal(restarted.host.sent.filter((row) => row.prompt === "检查 CI").length, 0);
});
