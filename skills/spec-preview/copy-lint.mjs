// L4: 按 JSON 字段报告可见文案问题。GLOSSARY 正文未使用的 Avoid 词优先报错。
// L5: 已知词汇来自 GLOSSARY 正文与目标项目 Git 跟踪的非测试文本。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PreviewError } from './preview-error.mjs';

const skillGlossary = fileURLToPath(new URL('../../GLOSSARY.md', import.meta.url));
const copyKeys = new Set(['name', 'label', 'text', 'note', 'items', 'columns', 'before', 'title', 'summary', 'q', 'versionNote']);
const han = /\p{Script=Han}/u;
const unspaced = /\p{Script=Han}[a-z]|[a-z][a-z0-9-]*\p{Script=Han}/iu;
const word = /[a-z][a-z0-9-]*/gi;
const versionLabel = /^v(?:0|[1-9]\d*)$/;
const avoidLine = /^:\s+_Avoid_:\s*(.*)$/;
const testPaths = ['test', 'tests', '__tests__', 'fixtures'].map(name => `:(glob,exclude)**/${name}/**`);

function readGlossary() {
  try {
    return readFileSync('GLOSSARY.md', 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return readFileSync(skillGlossary, 'utf8');
  }
}

function termPattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = /^[a-z0-9]/i.test(term) ? '(?<![a-z0-9_-])' : '';
  const end = /[a-z0-9]$/i.test(term) ? '(?![a-z0-9_-])' : '';
  return new RegExp(start + escaped + end, 'iu');
}

function glossaryTerms() {
  const lines = readGlossary().split(/\r?\n/);
  const body = lines.filter(line => !avoidLine.test(line)).join('\n');
  const forbidden = [];
  let canonical;
  for (const line of lines) {
    const heading = /^\*\*([^*]+)\*\*\s*$/.exec(line);
    if (heading) canonical = heading[1];
    const list = avoidLine.exec(line)?.[1];
    if (!canonical || !list) continue;
    for (const entry of list.replace(/。$/, '').split(/[、；]/)) {
      const term = entry.split('（')[0].trim();
      if (!term) continue;
      const pattern = termPattern(term);
      if (!pattern.test(body)) forbidden.push({ term, canonical, pattern });
    }
  }
  return { body, forbidden };
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
  for (const section of ['title', 'summary', 'changes', 'questions', 'versionNote', 'pages', 'flows', 'backend']) {
    for (const [path, copy] of copyFields(spec?.[section], section, section)) {
      const prose = copy.replace(/`[^`\n]*`|https?:\/\/[^\s，。；、]+/g, ' ');
      const terms = han.test(prose) ? (prose.match(word) ?? []).filter(term => !versionLabel.test(term)) : [];
      yield { path, prose, terms };
    }
  }
}

function spellings(term) {
  if (!/^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(term)) return [term];
  const parts = term.split(/(?<=[a-z0-9])(?=[A-Z])/).map(part => part.toLowerCase());
  return [term, ...['.', '-', '_'].map(separator => parts.join(separator))];
}

function trackedWords(directory, candidates) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = spawnSync('git', [
    '-C', directory, 'grep', '--cached', '--no-color', '-I', '-h', '-o', '-w', '-F', '-f', '-', '--', ...testPaths,
    ':(top,exclude)GLOSSARY.md',
  ], { input: candidates.join('\n'), encoding: 'utf8', env: { ...env, LC_ALL: 'C' }, maxBuffer: 32 * 1024 * 1024 });
  if (git.status === 0) return git.stdout.trimEnd().split('\n');
  if (git.status === 1 || (git.status === 128 && git.stderr.includes('not a git repository'))) return [];
  throw new PreviewError('BLOCKED', `无法读取 ${directory} 的仓库词汇。请检查 Git：${git.error?.message || git.stderr.trim()}`);
}

function knownTerms(fields, glossaryBody) {
  const known = new Set(glossaryBody.match(word) ?? []);
  const unresolved = new Set(fields.flatMap(({ terms }) => terms).filter(term => !known.has(term)));
  if (!unresolved.size) return known;

  const candidates = new Map([...unresolved].map(term => [term, spellings(term)]));
  const spellingsToFind = [...new Set([...candidates.values()].flat())];
  const tracked = new Set(trackedWords(process.cwd(), spellingsToFind));
  for (const [term, variants] of candidates) {
    if (variants.some(variant => tracked.has(variant))) known.add(term);
  }
  return known;
}

function violations({ prose, terms }, known, forbidden) {
  const issues = [];
  if (unspaced.test(prose)) issues.push('中英文之间缺空格');
  const matches = forbidden.filter(({ pattern }) => pattern.test(prose));
  for (const { term, canonical } of matches) issues.push('禁用术语 ' + term + '，用 ' + canonical);
  const bannedWords = new Set(matches.flatMap(({ term }) => term.toLowerCase().match(word) ?? []));
  const unknown = [...new Set(terms.filter(term => !bannedWords.has(term.toLowerCase()) && !known.has(term)))];
  if (unknown.length) issues.push(`未识别术语 ${unknown.join('、')}`);
  return issues;
}

export function assertPreviewCopy(spec) {
  const fields = [...previewProse(spec)];
  const { body, forbidden } = glossaryTerms();
  const known = knownTerms(fields, body);
  const errors = [];
  for (const field of fields) {
    const issues = violations(field, known, forbidden);
    if (issues.length) errors.push(`${field.path}  ${issues.join('，')}`);
  }
  if (errors.length) throw new PreviewError('CopyLint', `请修正 spec.json 中的文案后重试。\n${errors.join('\n')}`);
}
