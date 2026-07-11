const crypto = require('crypto');
const fs = require('fs');
const { builtinModules } = require('module');
const path = require('path');
const matter = require('gray-matter');

const EXPECTED = {
  'do-not-repeat-yourself': 'reusable-dependency',
  'dverity-repair': 'workflow-entry',
  'dverity-research': 'reusable-dependency',
  'dverity-simplify': 'reusable-dependency',
  'git-commit': 'reusable-dependency',
  'merge-remote-review': 'workflow-entry',
  postmortem: 'reusable-dependency',
  'resolving-merge-conflicts': 'reusable-dependency',
  'submit-remote-review': 'workflow-entry'
};

function sha256(parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function walkFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return walkFiles(target);
    if (entry.isFile()) return [target];
    throw new Error(`Unsupported source entry: ${target}`);
  });
}

function relativePath(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function hashFiles(root, files) {
  const parts = files.flatMap((file) => [
    relativePath(root, file),
    '\0',
    fs.readFileSync(file),
    '\0'
  ]);
  return sha256(parts);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolvedFile(root, target, kind) {
  if (!isInside(root, target)) throw new Error(`${kind} escapes package root: ${target}`);
  if (!fs.existsSync(target)) throw new Error(`Unresolved ${kind.toLowerCase()}: ${target}`);
  const real = fs.realpathSync(target);
  if (!isInside(root, real)) throw new Error(`${kind} escapes package root: ${target}`);
  if (!fs.statSync(real).isFile()) throw new Error(`Unresolved ${kind.toLowerCase()}: ${target}`);
  return real;
}

function importSpecifiers(content) {
  const pattern = /(?:require\s*\(|import\s*\(|\bfrom\s+|\bimport\s+)["']([^"']+)["']\s*\)?/g;
  return [...content.matchAll(pattern)].map((match) => match[1]);
}

function resolveImport(root, importer, specifier) {
  if (builtinModules.includes(specifier) || builtinModules.includes(specifier.replace(/^node:/, ''))) {
    return null;
  }
  if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) {
    throw new Error(`Import is not package-contained: ${specifier}`);
  }
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  const target = candidates.find((candidate) => fs.existsSync(candidate)) || base;
  return resolvedFile(root, target, 'Unresolved import');
}

function dependencyRecord(root, file) {
  return {
    path: relativePath(root, file),
    hash: sha256([fs.readFileSync(file)])
  };
}

function assertNoExternalSourcePaths(root, files) {
  const forbidden = /\/Users\/|[A-Za-z]:\\Users\\|(?:\.codex|\.claude)\/plugins\//;
  for (const file of files) {
    if (forbidden.test(fs.readFileSync(file, 'utf8'))) {
      throw new Error(`Personal or plugin path in ${relativePath(root, file)}`);
    }
  }
}

function resolveDependencies(root, skillRoot, parsed, files) {
  assertNoExternalSourcePaths(root, files);
  const declared = ['reads', 'resources'].flatMap((key) => (
    Array.isArray(parsed.data.metadata?.[key]) ? parsed.data.metadata[key] : []
  ));
  const readTargets = declared.map((item) => (
    resolvedFile(root, path.resolve(skillRoot, String(item)), 'Dependency')
  ));
  const importTargets = files.filter((file) => /\.(?:c?js|mjs)$/.test(file)).flatMap((file) => (
    importSpecifiers(fs.readFileSync(file, 'utf8'))
      .map((specifier) => resolveImport(root, file, specifier))
      .filter(Boolean)
  ));
  return [...new Set([...readTargets, ...importTargets])]
    .sort()
    .map((file) => dependencyRecord(root, file));
}

function readSkill(root, skillsRoot, entry) {
  const skillRoot = path.join(skillsRoot, entry.name);
  const skillFile = path.join(skillRoot, 'SKILL.md');
  if (!entry.isDirectory() || !fs.existsSync(skillFile)) {
    throw new Error(`Invalid Skill source entry: ${entry.name}`);
  }
  const parsed = matter(fs.readFileSync(skillFile, 'utf8'));
  if (parsed.data.name !== entry.name) {
    throw new Error(`Skill name/source mismatch: ${entry.name}`);
  }
  if (parsed.data.metadata?.dverity_class !== EXPECTED[entry.name]) {
    throw new Error(`Unexpected Skill or classification: ${entry.name}`);
  }
  const files = walkFiles(skillRoot).sort();
  const dependencies = resolveDependencies(root, skillRoot, parsed, files);
  return {
    id: entry.name,
    class: parsed.data.metadata.dverity_class,
    path: `skills/${entry.name}`,
    hash: hashFiles(skillRoot, files),
    files: files.map((file) => relativePath(skillRoot, file)),
    dependencies
  };
}

function enumerateSkillSource({ root }) {
  const packageRoot = fs.realpathSync(root);
  const skillsRoot = path.join(packageRoot, 'skills');
  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const skills = entries.map((entry) => readSkill(packageRoot, skillsRoot, entry));
  if (skills.length !== Object.keys(EXPECTED).length) {
    throw new Error(`Dverity Skill source must contain exactly ${Object.keys(EXPECTED).length} Skills`);
  }
  const sourceHash = skillSourceHash(skills);
  return {
    schema_version: 1,
    enumeration_run: `skills:${sourceHash}`,
    source_root: 'skills',
    source_hash: sourceHash,
    skills
  };
}

function skillSourceHash(skills) {
  return sha256(skills.flatMap((skill) => [
    skill.id,
    '\0',
    skill.hash,
    '\0',
    JSON.stringify(skill.dependencies),
    '\0'
  ]));
}

function consumerPlan(kind, source, extra = {}) {
  return {
    kind,
    enumeration_run: source.enumeration_run,
    source_hash: source.source_hash,
    skills: source.skills,
    ...extra
  };
}

function registryEntries(source) {
  return source.skills.map(({ id, class: skillClass, path: skillPath, hash }) => ({
    id,
    class: skillClass,
    path: skillPath,
    hash
  }));
}

function packageFiles(source) {
  return source.skills.flatMap((skill) => (
    skill.files.map((file) => `${skill.path}/${file}`)
  ));
}

function projectionEntries(source, root) {
  return source.skills.map(({ id, path: skillPath, hash }) => ({
    id,
    source: skillPath,
    target: `${root}/${id}`,
    hash
  }));
}

function buildSkillProvenance({ root, enumerate = enumerateSkillSource }) {
  const source = enumerate({ root });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const agentsRoot = '.agents/skills';
  const claudeRoot = '.claude/skills';
  return {
    schema_version: 1,
    source,
    package: consumerPlan('package', source, {
      identity: { name: pkg.name, version: pkg.version },
      files: packageFiles(source)
    }),
    registry: consumerPlan('registry', source, { entries: registryEntries(source) }),
    installer: consumerPlan('installer', source, {
      projections: expectedInstallerProjections(source)
    }),
    projections: {
      agents: consumerPlan('projection', source, {
        root: agentsRoot,
        entries: projectionEntries(source, agentsRoot)
      }),
      claude: consumerPlan('projection', source, {
        root: claudeRoot,
        entries: projectionEntries(source, claudeRoot)
      })
    }
  };
}

function provenanceConsumers(graph) {
  return [
    ['package', graph.package],
    ['registry', graph.registry],
    ['installer', graph.installer],
    [graph.projections.agents.root, graph.projections.agents],
    [graph.projections.claude.root, graph.projections.claude]
  ];
}

function expectedInstallerProjections(source) {
  return ['.agents/skills', '.claude/skills'].map((root) => ({
    root,
    enumeration_run: source.enumeration_run
  }));
}

function derivedPlanError(graph) {
  const checks = [
    ['package plan drift', graph.package.files, packageFiles(graph.source)],
    ['registry plan drift', graph.registry.entries, registryEntries(graph.source)],
    ['installer plan drift', graph.installer.projections, expectedInstallerProjections(graph.source)],
    [
      '.agents/skills projection plan drift',
      graph.projections.agents.entries,
      projectionEntries(graph.source, '.agents/skills')
    ],
    [
      '.claude/skills projection plan drift',
      graph.projections.claude.entries,
      projectionEntries(graph.source, '.claude/skills')
    ]
  ];
  return checks.find(([, actual, expected]) => (
    JSON.stringify(actual) !== JSON.stringify(expected)
  ))?.[0];
}

function validateSkillProvenance(graph) {
  if (graph.package.identity.name !== 'dverity' || graph.package.identity.version !== '5.0.0') {
    return { success: false, error: 'package identity must be dverity@5.0.0' };
  }
  if (skillSourceHash(graph.source.skills) !== graph.source.source_hash) {
    return { success: false, error: 'source provenance hash drift' };
  }
  for (const [name, consumer] of provenanceConsumers(graph)) {
    const secondary = consumer.enumeration_run !== graph.source.enumeration_run
      || consumer.source_hash !== graph.source.source_hash;
    if (secondary) {
      return { success: false, error: `${name} has secondary enumeration provenance` };
    }
    if (JSON.stringify(consumer.skills) !== JSON.stringify(graph.source.skills)) {
      return { success: false, error: `${name} has same-name source drift` };
    }
  }
  const planError = derivedPlanError(graph);
  if (planError) return { success: false, error: planError };
  return { success: true };
}

module.exports = {
  buildSkillProvenance,
  enumerateSkillSource,
  validateSkillProvenance
};
