// S1、S11 使用的渲染命令夹具，保留默认输出、-o 和当前版本归档。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [source, flag, output] = process.argv.slice(2);
const spec = readFileSync(source, 'utf8');
const { version } = JSON.parse(spec);
const directory = dirname(source);
const html = flag === '-o' ? output : join(directory, 'preview.html');
const text = spec.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

writeFileSync(html, `<!doctype html>\n<meta charset="utf-8">\n<pre>${text}</pre>\n`);
writeFileSync(join(directory, `spec-v${version}.json`), spec);
