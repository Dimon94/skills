/**
 * 命令语法测试：/loop 参数如何变成新建请求、动作或错误。
 * 目标：节奏误判（把提示词当间隔）、缺选项值、危险斜杠前缀放行，都必须让断言失败。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveName, parseLoopArgs, uniqueName } from "../lib/command.js";

const NOW = 1_800_000_000_000;

test("新建：三种节奏与选项", () => {
	const fixed = parseLoopArgs("5m 检查 CI", { cwd: "/tmp", now: NOW });
	assert.equal(fixed.kind, "create");
	assert.equal(fixed.request.mode, "interval");
	assert.equal(fixed.request.everyMs, 300_000);
	assert.equal(fixed.request.prompt, "检查 CI");
	assert.equal(fixed.request.promptKind, "text");

	const auto = parseLoopArgs("auto --name=sweep --max=3 --until=2h /skill:issue-sweep wip=2", { cwd: "/tmp", now: NOW });
	assert.equal(auto.request.mode, "auto");
	assert.equal(auto.request.name, "sweep");
	assert.equal(auto.request.maxFires, 3);
	assert.equal(auto.request.expiresAt, NOW + 7_200_000);
	assert.equal(auto.request.prompt, "/skill:issue-sweep wip=2");
	assert.equal(auto.request.promptKind, "command");

	const cron = parseLoopArgs("cron 0 9 * * 1-5 汇总昨天的流水", { cwd: "/tmp", now: NOW });
	assert.equal(cron.request.mode, "cron");
	assert.equal(cron.request.cron.text, "0 9 * * 1-5");
	assert.equal(cron.request.prompt, "汇总昨天的流水");
});

test("新建失败：提示词像间隔、选项缺值、名字不合规都给明确错误", () => {
	assert.equal(parseLoopArgs("", {}).kind, "list");
	assert.match(parseLoopArgs("5x 检查", {}).error, /既不是节奏也不是子命令/);
	assert.match(parseLoopArgs("30s 检查", {}).error, /最短间隔/);
	assert.match(parseLoopArgs("5m", {}).error, /缺提示词/);
	assert.match(parseLoopArgs("5m --max 检查", {}).error, /要写成 --max=值/);
	assert.match(parseLoopArgs("--name=Bad 5m 检查", {}).error, /名字 Bad 不合规/);
	assert.match(parseLoopArgs("5m @/tmp/does-not-exist.md", {}).error, /不存在/);
	assert.match(parseLoopArgs("cron 0 9 * 13 * 汇总", {}).error, /month|月/);
	assert.match(parseLoopArgs("list extra", {}).error, /不接受参数/);
});

test("动作：list / stop / pause / resume / run", () => {
	assert.equal(parseLoopArgs("list", {}).kind, "list");
	for (const action of ["stop", "pause", "resume", "run"]) {
		const parsed = parseLoopArgs(`${action} sweep`, {});
		assert.equal(parsed.kind, "action");
		assert.equal(parsed.action, action);
		assert.equal(parsed.name, "sweep");
	}
	assert.match(parseLoopArgs("stop", {}).error, /要跟名字/);
});

test("名字派生与去重", () => {
	assert.equal(deriveName({ promptKind: "command", prompt: "/skill:issue-sweep wip=2" }), "issue-sweep");
	assert.equal(deriveName({ promptKind: "text", prompt: "检查 CI 状态" }), "ci");
	assert.equal(deriveName({ promptKind: "text", prompt: "检查状态" }), "loop");
	assert.equal(uniqueName("sweep", new Set(["sweep"])), "sweep-2");
	assert.equal(uniqueName("sweep", new Set(["sweep", "sweep-2"])), "sweep-3");
	assert.ok(uniqueName("a".repeat(32), new Set(["a".repeat(32)])).length <= 32);
});
