const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const {
  importSpecifiers,
  isHistoryInputPath: historyOnly,
  isHistoryReference: historyReference
} = require('../install/skill-source');

const LEGACY_PREFIX = ['c', 'c', '-'].join('');
const REMOVED_SKILLS = new Set([
  ['setup', 'pre', 'commit'].join('-'),
  ['quality', 'gate', 'contract'].join('-'),
  ['diagnosing', 'bugs'].join('-')
]);
const LEGACY_CLI = ['c', 'c', '-', 'devflow'].join('');
const LEGACY_TOKEN_SOURCE = `(?:${LEGACY_PREFIX}[a-z0-9-]+|${[...REMOVED_SKILLS].join('|')})`;
const REMOVED_CONFIG = new Set([
  'config/adapters.yml',
  'config/distributable-skills.json',
  'config/managed-resource-copies.json',
  'config/user-config.template.yml'
]);
const REMOVED_OUTPUT_ROOTS = ['.agent/', '.codex/', '.cursor/', '.qwen/', '.agents/', '.claude/'];
const CANONICAL_CHAIN = [
  'repair', 'verified local', 'submit', 'review ready', 'merge', 'verified remote main'
];
const STATE_FAMILIES = [
  /plan|diagnos|debug|repair/,
  /\bdo\b|implement|execute|fix/,
  /check|review|verify|inspect/,
  /act|land|ship|merge/
];

function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return walk(target);
    return entry.isFile() ? [target] : [];
  });
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function legacyMatches(text) {
  return text.match(new RegExp(`\\b${LEGACY_TOKEN_SOURCE}\\b`, 'g')) || [];
}

function occurrences(text) {
  let migrationInput = false;
  return text.split('\n').flatMap((line, index) => {
    if (/^```legacy-input\s*$/.test(line) || /dverity:legacy-input:start/.test(line)) {
      migrationInput = true;
    } else if ((migrationInput && /^```\s*$/.test(line))
      || /dverity:legacy-input:end/.test(line)) {
      migrationInput = false;
    }
    return legacyMatches(line).map((token) => ({ line: index + 1, migrationInput, token }));
  });
}

function candidate(pathname, type, found) {
  return {
    path: pathname,
    type,
    tokens: [...new Set(found.map(({ token }) => token))]
  };
}

function legacySkillPath(rel) {
  const match = rel.match(/^(?:skills|\.agents\/skills|\.claude\/skills)\/([^/]+)\//);
  return match && (match[1].startsWith(LEGACY_PREFIX) || REMOVED_SKILLS.has(match[1]));
}

function legacyFrontmatter(rel, text) {
  if (!/(?:^|\/)SKILL\.md$/.test(rel)) return false;
  try {
    return legacyMatches(JSON.stringify(matter(text).data)).length > 0;
  } catch {
    return false;
  }
}

function frontmatterHistory(rel, text) {
  if (!/(?:^|\/)SKILL\.md$/.test(rel)) return false;
  try {
    const data = matter(text).data;
    const refs = ['reads', 'resources'].flatMap((key) => [
      ...(Array.isArray(data[key]) ? data[key] : []),
      ...(Array.isArray(data.metadata?.[key]) ? data.metadata[key] : [])
    ]);
    return refs.some((ref) => historyReference(ref));
  } catch {
    return false;
  }
}

function isAcceptanceCatalog(rel, text) {
  if (rel !== 'acceptance/catalog.json') return false;
  try {
    const catalog = JSON.parse(text);
    return catalog.schema_version === 1 && Array.isArray(catalog.rows)
      && catalog.rows.every((row) => /^DV-[A-Z]+-\d{3}$/.test(row.acceptance_id));
  } catch {
    return false;
  }
}

function isNegativeFixture(rel) {
  return rel.includes('/__tests__/') || rel.startsWith('test/');
}

function isCurrentDoc(rel) {
  return rel !== 'DVERITY.md' && rel !== 'docs/migration-v5.md'
    && !rel.startsWith('skills/') && (rel.startsWith('docs/') || /\.md$/.test(rel));
}

function parsedNode(raw, labels) {
  const text = raw.replace(/\|[^|]*\|/g, '').trim();
  const decorated = text.match(/^([A-Za-z0-9_-]+)\s*[\[({]["']?([^\]})"']+)/);
  const id = (decorated?.[1] || text).replace(/[^A-Za-z0-9_-]/g, '').toLowerCase();
  const label = (decorated?.[2] || labels.get(id) || text)
    .replace(/[^A-Za-z -]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (decorated) labels.set(id, label);
  return label ? { id: id || label, label } : null;
}

function edgeNodes(line, labels) {
  if (!/-+>/.test(line)) return [];
  return line.split(/\s*-+>\s*/).map((raw) => parsedNode(raw, labels)).filter(Boolean);
}

function stateEdges(text) {
  const labels = new Map();
  const edges = [];
  let fenced = false;
  let previous = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^```/.test(line)) { fenced = !fenced; previous = null; continue; }
    const nodes = edgeNodes(line, labels);
    if (nodes.length === 1 && /^-+>/.test(line) && previous) nodes.unshift(previous);
    for (let index = 1; index < nodes.length; index += 1) edges.push([nodes[index - 1], nodes[index]]);
    if (nodes.length) previous = nodes.at(-1);
    else if (fenced && !/^flowchart\b/i.test(line)) {
      const plain = /^[A-Za-z][A-Za-z ]+$/.test(line);
      const declaration = /^[A-Za-z0-9_-]+\s*[\[({]/.test(line);
      if (plain || declaration) {
        const node = parsedNode(line, labels);
        if (plain) previous = node;
      }
    }
  }
  return edges;
}

function legacyStatePath(pathname) {
  if (JSON.stringify(pathname) === JSON.stringify(CANONICAL_CHAIN)) return false;
  return STATE_FAMILIES.filter((family) => pathname.some((state) => family.test(state))).length >= 3;
}

function duplicateStateMachine(text) {
  const edges = stateEdges(text);
  const outgoing = new Map();
  const incoming = new Set(edges.map(([, target]) => target.id));
  for (const [source, target] of edges) {
    outgoing.set(source.id, [...(outgoing.get(source.id) || []), target]);
  }
  function visit(node, labels, seen) {
    const next = outgoing.get(node.id) || [];
    if (!next.length) return legacyStatePath(labels);
    return next.some((target) => !seen.has(target.id)
      && visit(target, [...labels, target.label], new Set([...seen, target.id])));
  }
  const starts = edges.map(([source]) => source).filter((node) => !incoming.has(node.id));
  return starts.some((start) => visit(start, [start.label], new Set([start.id])));
}

function removedModuleImport(text) {
  return importSpecifiers(text).some((specifier) => (
    /(?:^|\/)(?:compiler|skill-runtime|adapters)(?:\/|$)/.test(specifier)
  ));
}

function legacyRouteImport(text) {
  return importSpecifiers(text).some((specifier) => legacyMatches(specifier).length > 0);
}

function dynamicSkillRoute(text) {
  const calls = [...text.matchAll(/\b(?:require|import)\s*\(([^\n)]*)\)/g)];
  return calls.some(([, expression]) => {
    const value = expression.trim();
    const literal = /^(['"])[^'"]+\1$/.test(value);
    return !literal && /skills|LEGACY|legacy/.test(value);
  });
}

function historyReachability(text) {
  const calls = [...text.matchAll(/\b(?:require|import|readFileSync|readFile|createReadStream)\s*\(([^\n)]*)\)/g)];
  return calls.some(([, expression]) => historyReference(expression));
}

function packageLegacySurface(rel, text) {
  if (rel !== 'package.json') return false;
  try {
    const pkg = JSON.parse(text);
    const active = JSON.stringify({ bin: pkg.bin, files: pkg.files, scripts: pkg.scripts });
    return legacyMatches(active).length > 0
      || /(?:lib\/(?:compiler|skill-runtime|adapters)|bin\/adapt\.js|\.codex|\.cursor|\.qwen|\.agent)/.test(active);
  } catch {
    return legacyMatches(text).length > 0;
  }
}

function structuralType(rel, text, found) {
  const output = REMOVED_OUTPUT_ROOTS.some((root) => rel.startsWith(root));
  const rules = [
    [historyOnly(rel) && found.length, 'history-only'],
    [legacySkillPath(rel), 'runtime-id'],
    [legacyFrontmatter(rel, text), 'runtime-id'],
    [frontmatterHistory(rel, text), 'reachable-route'],
    [rel === 'bin/adapt.js' || rel.startsWith(`bin/${LEGACY_CLI}`), 'command-handler'],
    [REMOVED_CONFIG.has(rel) || output, 'current-output'],
    [/^lib\/(?:adapters|compiler|skill-runtime)\//.test(rel), 'reachable-route'],
    [removedModuleImport(text), 'reachable-route'],
    [rel.startsWith(`test/${LEGACY_PREFIX}`) || rel.startsWith('tests/'), 'reachable-route'],
    [isNegativeFixture(rel) && (found.length || duplicateStateMachine(text)), 'negative-fixture'],
    [rel.startsWith('lib/dverity/migration/') && (found.length || historyReachability(text)), 'migration-input'],
    [isAcceptanceCatalog(rel, text) && found.length, 'negative-fixture'],
    [isCurrentDoc(rel) && (found.length || duplicateStateMachine(text)), 'current-doc'],
    [historyReachability(text) || legacyRouteImport(text), 'reachable-route'],
    [dynamicSkillRoute(text), 'unclassified'],
    [duplicateStateMachine(text), 'duplicate-state-machine'],
    [packageLegacySurface(rel, text), 'command-handler']
  ];
  return rules.find(([matches]) => matches)?.[1] || null;
}

function taggedCandidates(rel, found, taggedType, untaggedType) {
  return [true, false].flatMap((tagged) => {
    const matches = found.filter(({ migrationInput }) => migrationInput === tagged);
    return matches.length
      ? [candidate(rel, tagged ? taggedType : untaggedType, matches)]
      : [];
  });
}

function tokenCandidates(rel, found) {
  if (rel.startsWith('lib/dverity/')) {
    return taggedCandidates(rel, found, 'migration-input', 'reachable-route');
  }
  if (rel.startsWith('skills/')) return [candidate(rel, 'runtime-id', found)];
  if (rel === 'docs/migration-v5.md') {
    return taggedCandidates(rel, found, 'migration-input', 'current-doc');
  }
  return [candidate(rel, 'unclassified', found)];
}

function classifyFile(root, file) {
  const rel = relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  const found = occurrences(text);
  const type = structuralType(rel, text, found);
  if (type) return [candidate(rel, type, found.length ? found : [{ token: 'typed-signal' }])];
  return found.length ? tokenCandidates(rel, found) : [];
}

function classifyLegacySurface({ root }) {
  return walk(root).flatMap((file) => classifyFile(root, file))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function legacyRuntimeViolations(candidates) {
  const allowed = new Set(['history-only', 'migration-input', 'negative-fixture']);
  return candidates.filter(({ type }) => !allowed.has(type));
}

module.exports = { classifyLegacySurface, legacyRuntimeViolations };
