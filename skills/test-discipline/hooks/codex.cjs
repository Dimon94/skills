const fs = require("node:fs");
const path = require("node:path");
const { testFileLocations } = require("./core.cjs");

/* L3-L6 -- Codex transcript 去重
 * IN: 已校验的 cwd、字面量写入目标；transcript_path 可缺省或为 null，否则须为绝对普通文件路径。
 * OUT: 只认 developer 消息内以真实提醒开头、带 FILES_MARKER 的绝对路径数组；旧提醒继续触发一次。
 * STATE: 每次流式读取完整 JSONL 记录；尾部未结束行留待下次读取，不新建持久状态。
 * FAIL: 路径、读取、完整记录或标记非法时抛错，由 entry.cjs 映射为 stderr 与退出 1。
 * LIMIT: 无 transcript 时不去重；并发调用在提醒写入日志前可能重复，路径别名不合并。
 * TEST: repo://skills/test-discipline/tests/hook.test.cjs「缝 1 Codex 去重」。
 */
const FILES_MARKER = "[test-discipline:files] ";

function recordFiles(line, seen) {
  if (!line.trim()) return;
  const record = JSON.parse(line);
  const message = record?.payload;
  if (record?.type !== "response_item" || message?.type !== "message" || message.role !== "developer") return;
  for (const item of message.content || []) {
    if (item.type !== "input_text" || !item.text?.startsWith("[test-discipline] 命中测试文件：")) continue;
    const marker = item.text.split("\n").find((line) => line.startsWith(FILES_MARKER));
    if (!marker) continue;
    const files = JSON.parse(marker.slice(FILES_MARKER.length));
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0"))) {
      throw new Error("提醒路径标记必须为绝对路径数组");
    }
    for (const file of files) seen.add(path.resolve(file));
  }
}

async function readRemindedFiles(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || filename.includes("\0")) {
    throw new Error("transcript_path 必须为绝对文件路径；修正路径或传 null 后重试");
  }
  const seen = new Set();
  try {
    if (!(await fs.promises.stat(filename)).isFile()) throw new Error("必须是普通文件");
    let pending = "";
    for await (const chunk of fs.createReadStream(filename, { encoding: "utf8" })) {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop();
      for (const line of lines) recordFiles(line, seen);
    }
  } catch (error) {
    const reason = error instanceof SyntaxError ? "完整记录或提醒路径标记不是合法 JSON" : error.code || error.message;
    throw new Error(`无法读取 transcript_path ${filename}（${reason}）；修正日志或路径后重试`, { cause: error });
  }
  return seen;
}

async function unseenFiles(cwd, targets, transcriptPath) {
  const files = testFileLocations(cwd, targets).map(({ absolute }) => absolute);
  if (!files.length || transcriptPath == null) return files;
  const seen = await readRemindedFiles(transcriptPath);
  return files.filter((file) => !seen.has(file));
}

module.exports = { FILES_MARKER, unseenFiles };
