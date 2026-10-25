#!/usr/bin/env node
/**
 * pi-loop 扩展安装器。
 *
 * L3 职责：把 skills/pi-loop/lib 以目录 symlink 接进 pi 扩展目录；提供 --check 与 --uninstall。
 * L4 依赖：Node 内置 fs、os、path、url。
 * L5 入口：node skills/pi-loop/scripts/install.js [--check|--uninstall]
 * L6 状态：只写 <扩展目录>/pi-loop 这一个 symlink。扩展目录默认 ~/.pi/agent/extensions，PI_EXTENSIONS_DIR 覆盖。
 *
 * INVARIANT：拒绝覆盖或删除非 symlink；--uninstall 只删指向本 Skill 的链接。
 * OUT：--check 打印 installed / missing / drift，installed 退出 0，其余退出 1。
 */

import { lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "lib");
const EXTENSIONS_DIR = resolve(process.env.PI_EXTENSIONS_DIR || join(homedir(), ".pi", "agent", "extensions"));
const TARGET = join(EXTENSIONS_DIR, "pi-loop");

function inspect() {
	let stat;
	try {
		stat = lstatSync(TARGET);
	} catch {
		return "missing";
	}
	if (!stat.isSymbolicLink()) return "foreign";
	const link = resolve(EXTENSIONS_DIR, readlinkSync(TARGET));
	let real = link;
	try {
		real = realpathSync(link);
	} catch {
		return "drift";
	}
	return real === realpathSync(SOURCE) ? "installed" : "drift";
}

function main(argv) {
	const mode = argv[0] ?? "--install";
	if (!["--install", "--check", "--uninstall"].includes(mode) || argv.length > 1) {
		console.error("用法：node skills/pi-loop/scripts/install.js [--check|--uninstall]");
		return 2;
	}
	const state = inspect();

	if (mode === "--check") {
		console.log(`${state === "foreign" ? "drift" : state}: ${TARGET}`);
		return state === "installed" ? 0 : 1;
	}

	if (state === "foreign") {
		console.error(`pi-loop: ${TARGET} 不是 symlink，拒绝改动；移走后重试`);
		return 1;
	}

	if (mode === "--uninstall") {
		if (state === "missing") {
			console.log(`未安装：${TARGET}`);
			return 0;
		}
		if (state === "drift") {
			console.error(`pi-loop: ${TARGET} 指向别处，拒绝删除；确认后手动处理`);
			return 1;
		}
		rmSync(TARGET);
		console.log(`已卸载：${TARGET}。在 pi 里 /reload 生效`);
		return 0;
	}

	if (state === "installed") {
		console.log(`已安装：${TARGET} -> ${SOURCE}`);
		return 0;
	}
	if (state === "drift") {
		console.error(`pi-loop: ${TARGET} 指向别处，拒绝覆盖；先 --uninstall 或手动处理`);
		return 1;
	}
	mkdirSync(EXTENSIONS_DIR, { recursive: true });
	symlinkSync(SOURCE, TARGET, "dir");
	console.log(`已安装：${TARGET} -> ${SOURCE}。在 pi 里 /reload，然后 /loop help`);
	return 0;
}

process.exitCode = main(process.argv.slice(2));
