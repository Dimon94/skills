// 夹具只支持场景中的 smyw-patch@2 节点修改与归档。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [feedback, source] = process.argv.slice(2);
const block = /```json\r?\n([\s\S]+?)\r?\n```/.exec(readFileSync(feedback, 'utf8'));
const patch = block && JSON.parse(block[1]);
if (patch?.format !== 'smyw-patch@2') process.exit(0);

const original = readFileSync(source, 'utf8');
const spec = JSON.parse(original);
if (patch.base !== spec.version) {
  console.error(`反馈基于 v${patch.base}，当前为 v${spec.version}`);
  process.exit(1);
}
for (const op of patch.ops) {
  const node = spec.pages[0].root.children.find(({ id }) => id === op.id);
  if (op.op !== 'set' || !node) throw new Error(`夹具不支持操作 ${op.op} #${op.id}`);
  Object.assign(node, op.set);
}
writeFileSync(join(dirname(source), `spec-v${spec.version}.json`), original);
spec.version += 1;
writeFileSync(source, JSON.stringify(spec, null, 2) + '\n');
