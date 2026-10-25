/**
 * 节奏层测试：间隔写法、cron 匹配与结算时刻。
 * 目标：错误实现（单位换算、日/周并集、跨日跳格、指针重复）必须让至少一条断言失败。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, nextCronAt, parseCron, parseInterval } from "../lib/schedule.js";

test("间隔写法：合法值换算成毫秒，越界与乱序被拒", () => {
	assert.deepEqual(parseInterval("90s"), { ms: 90_000 });
	assert.deepEqual(parseInterval("5m"), { ms: 300_000 });
	assert.deepEqual(parseInterval("1h30m"), { ms: 5_400_000 });
	assert.deepEqual(parseInterval("1d"), { ms: 86_400_000 });

	assert.match(parseInterval("30s").error, /最短间隔 1m/);
	assert.match(parseInterval("2d").error, /最长间隔 1d/);
	assert.match(parseInterval("30m1h").error, /从大到小/);
	assert.match(parseInterval("every 5 minutes").error, /格式不对/);
	assert.match(parseInterval("").error, /为空/);
});

test("时长文案：秒、分、时分、天时", () => {
	assert.equal(formatDuration(45_000), "45s");
	assert.equal(formatDuration(59_600), "1m", "先取整再分档，不能出现 60s");
	assert.equal(formatDuration(300_000), "5m");
	assert.equal(formatDuration(5_400_000), "1h30m");
	assert.equal(formatDuration(183_600_000), "2d3h");
});

test("cron：指针、步长、范围与日/周并集", () => {
	const atLocal = (date, hour, minute) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime();

	// 工作日 9:00：周五晚问，答案是周一 9:00。
	const weekday = parseCron("0 9 * * 1-5").cron;
	const friday = new Date("2026-03-06T20:00:00");
	const monday = new Date(2026, 2, 9);
	assert.equal(nextCronAt(weekday, friday.getTime()), atLocal(monday, 9, 0));

	// 步长：每 15 分钟，从 10:07 起下一个是 10:15。
	const quarter = parseCron("*/15 * * * *").cron;
	assert.equal(nextCronAt(quarter, atLocal(monday, 10, 7)), atLocal(monday, 10, 15));
	// 整点边界：10:15 整发问，下一个必须是 10:30，不能重复 10:15。
	assert.equal(nextCronAt(quarter, atLocal(monday, 10, 15)), atLocal(monday, 10, 30));

	// 日与周都受限时取并集：每月 1 号或每周一。
	const union = parseCron("0 0 1 * 1").cron;
	const tuesday = new Date(2026, 2, 10);
	assert.equal(nextCronAt(union, tuesday.getTime()), atLocal(new Date(2026, 2, 16), 0, 0), "下一个应比 4 月 1 号更早出现的周一");

	assert.match(parseCron("0 9 * *").error, /5 个字段/);
	assert.match(parseCron("0 25 * * *").error, /超出 0-23/);
	assert.match(parseCron("*/0 * * * *").error, /步长/);
});
