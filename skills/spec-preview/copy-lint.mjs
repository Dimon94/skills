// L4: 检查 smyw 的页面、流程和后端文案，按 JSON 字段报告问题。
// L4: 词汇证据来自 GLOSSARY.md 和 Git 跟踪的非测试文本。代码名可用已有标识符的命名变体。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PreviewError } from './preview-error.mjs';

const skillGlossary = fileURLToPath(new URL('../../GLOSSARY.md', import.meta.url));
const copyKeys = new Set(['name', 'label', 'text', 'note', 'items', 'columns', 'before']);
const han = /\p{Script=Han}/u;
const unspaced = /\p{Script=Han}[a-z]|[a-z][a-z0-9-]*\p{Script=Han}/iu;
const word = /[a-z][a-z0-9-]*/gi;
const testPaths = ['test', 'tests', '__tests__', 'fixtures'].map(name => `:(glob,exclude)**/${name}/**`);

function readGlossary() {
  try {
    return readFileSync('GLOSSARY.md', 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return readFileSync(skillGlossary, 'utf8');
  }
}

function* copyFields(value, path, key) {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) yield* copyFields(child, `${path}[${index}]`, key);
  } else if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) yield* copyFields(child, `${path}.${name}`, name);
  } else if (typeof value === 'string' && copyKeys.has(key)) {
    yield [path, value];
  }
}

function* previewProse(spec) {
  for (const section of ['pages', 'flows', 'backend']) {
    for (const [path, copy] of copyFields(spec?.[section], section)) {
      const prose = copy.replace(/`[^`\n]*`|https?:\/\/[^\s，。；、]+/g, ' ');
      if (han.test(prose)) yield { path, prose, terms: prose.match(word) ?? [] };
    }
  }
}

function spellings(term) {
  if (!/^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(term)) return [term];
  const parts = term.split(/(?<=[a-z0-9])(?=[A-Z])/).map(part => part.toLowerCase());
  return [term, ...['.', '-', '_'].map(separator => parts.join(separator))];
}

function trackedWords(directory, candidates) {
  const git = spawnSync('git', [
    '-C', directory, 'grep', '--cached', '--no-color', '-I', '-h', '-o', '-w', '-F', '-f', '-', '--', ...testPaths,
  ], { input: candidates.join('\n'), encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  if (git.status === 0) return git.stdout.trimEnd().split('\n');
  if (git.status === 1 || (git.status === 128 && git.stderr.includes('not a git repository'))) return [];
  throw new PreviewError('BLOCKED', `无法读取 ${directory} 的仓库词汇。请检查 Git：${git.error?.message || git.stderr.trim()}`);
}

function knownTerms(fields) {
  const declarations = readGlossary().matchAll(/^(?:-\s+)?\*\*([^*\n]+)\*\*(?:[:：]|[ \t]*$)/gm);
  const known = new Set([...declarations].flatMap(([, term]) => term.match(word) ?? []));
  const unresolved = new Set(fields.flatMap(({ terms }) => terms).filter(term => !known.has(term)));
  if (!unresolved.size) return known;

  const candidates = new Map([...unresolved].map(term => [term, spellings(term)]));
  const spellingsToFind = [...new Set([...candidates.values()].flat())];
  const directories = new Set([process.cwd(), dirname(skillGlossary)]);
  const tracked = new Set([...directories].flatMap(directory => trackedWords(directory, spellingsToFind)));
  for (const [term, variants] of candidates) {
    if (variants.some(variant => tracked.has(variant))) known.add(term);
  }
  return known;
}

function violations({ prose, terms }, known) {
  const unknown = [...new Set(terms.filter(term => !known.has(term)))];
  const issues = [];
  if (unspaced.test(prose)) issues.push('中英文之间缺空格');
  if (unknown.length) issues.push(`未识别术语 ${unknown.join('、')}`);
  return issues;
}

export function assertPreviewCopy(spec) {
  const fields = [...previewProse(spec)];
  const known = knownTerms(fields);
  const errors = [];
  for (const field of fields) {
    const issues = violations(field, known);
    if (issues.length) errors.push(`${field.path}  ${issues.join('，')}`);
  }
  if (errors.length) throw new PreviewError('CopyLint', `请修正 spec.json 中的文案后重试。\n${errors.join('\n')}`);
}
