// L4: 检查 smyw 的页面、流程和后端文案，按 JSON 字段报告问题。
import { readFileSync } from 'node:fs';
import { PreviewError } from './preview-error.mjs';

const copyKeys = new Set(['name', 'label', 'text', 'note', 'items', 'columns', 'before']);
const han = /\p{Script=Han}/u;
const unspaced = /\p{Script=Han}[a-z]|[a-z][a-z0-9-]*\p{Script=Han}/iu;

function readGlossary() {
  try {
    return readFileSync('GLOSSARY.md', 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return readFileSync(new URL('../../GLOSSARY.md', import.meta.url), 'utf8');
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

function violations(copy, glossaryTerms) {
  const prose = copy.replace(/`[^`\n]*`|https?:\/\/[^\s，。；、]+/g, ' ');
  if (!han.test(prose)) return [];
  const terms = prose.match(/[a-z][a-z0-9-]*/gi) ?? [];
  const unknown = [...new Set(terms.filter(term => !glossaryTerms.has(term)))];
  const issues = [];
  if (unspaced.test(prose)) issues.push('中英文之间缺空格');
  if (unknown.length) issues.push(`GLOSSARY.md 未定义术语 ${unknown.join('、')}`);
  return issues;
}

export function assertPreviewCopy(spec) {
  const declarations = readGlossary().matchAll(/^(?:-\s+)?\*\*([^*\n]+)\*\*(?:[:：]|[ \t]*$)/gm);
  const glossaryTerms = new Set([...declarations].flatMap(([, term]) => term.match(/[a-z][a-z0-9-]*/gi) ?? []));
  const errors = [];
  for (const section of ['pages', 'flows', 'backend']) {
    for (const [path, copy] of copyFields(spec?.[section], section)) {
      const issues = violations(copy, glossaryTerms);
      if (issues.length) errors.push(`${path}  ${issues.join('，')}`);
    }
  }
  if (errors.length) throw new PreviewError('CopyLint', `请修正 spec.json 中的文案后重试。\n${errors.join('\n')}`);
}
