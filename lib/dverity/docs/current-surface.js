const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { classifyLegacySurface } = require('../legacy/classifier');
const { isHistoryInputPath } = require('../install/skill-source');

const MIT_BODY_HASH = 'fe2a9817987f862eaced948f0468c7f51d2fedfc48c5c505b246a49a3870e9a5';
const COMMUNITY_ASSET = /(?:wechat|chat[-_ ]?group|qr(?:[-_ ]?code)?|微信|交流群|二维码)/i;
const OLD_PREFIX = ['c', 'c'].join('');
const OLD_PRODUCT = [OLD_PREFIX, 'devflow'].join('-');
const LEGACY_CURRENT = [
  new RegExp(`${OLD_PREFIX}[-_ ]?devflow`, 'i'),
  new RegExp(`\\b${OLD_PREFIX}-[a-z0-9-]+\\b`, 'i'),
  new RegExp(`github\\.com/Dimon94/${OLD_PRODUCT}`, 'i'),
  new RegExp(`npmjs\\.com/package/${OLD_PRODUCT}`, 'i'),
  /(?:^|\/)\.(?:agent|codex|cursor|qwen)(?:\/|\b)/i,
  /(?:wechat|chat group|微信|交流群|二维码)/i
];

function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return walk(target);
    return entry.isFile() ? [target] : [];
  });
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function captureHistory(root) {
  return Object.fromEntries(walk(root)
    .map((file) => [relative(root, file), file])
    .filter(([rel]) => isHistoryInputPath(rel))
    .map(([rel, file]) => [rel, sha256(fs.readFileSync(file))]));
}

function licenseBodyHash(text) {
  const start = text.indexOf('Permission is hereby granted');
  if (start < 0) return null;
  return sha256(text.slice(start).replace(/\s+/g, ' ').trim());
}

function isCurrentTextPath(rel) {
  if (rel === 'DVERITY.md' || isHistoryInputPath(rel)) return false;
  if (!rel.includes('/')) return /\.(?:md|json|ya?ml)$/.test(rel);
  const currentRoot = rel.startsWith('docs/') || rel.startsWith('.github/');
  return currentRoot && /\.(?:md|json|sh|ya?ml)$/.test(rel);
}

function validateLicense(errors, root) {
  const target = path.join(root, 'LICENSE');
  const license = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (!license.includes('Copyright (c) 2025 Dimon')) {
    errors.push('License notice must be Copyright (c) 2025 Dimon');
  }
  if (licenseBodyHash(license) !== MIT_BODY_HASH) errors.push('MIT license body semantics changed');
}

function validatePackage(errors, root) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); }
  catch { errors.push('Missing or invalid package.json'); return; }
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (pkg.name !== 'dverity' || pkg.version !== '5.0.0') errors.push('Package identity must be dverity@5.0.0');
  if (pkg.description !== 'Truth before main.') errors.push('Package description must be the Dverity promise');
  if (repository !== 'git+https://github.com/Dimon94/dverity.git') errors.push('Package repository must be Dimon94/dverity');
  if (pkg.homepage !== 'https://github.com/Dimon94/dverity#readme') errors.push('Package homepage must be the Dverity repository');
  if (pkg.bugs?.url !== 'https://github.com/Dimon94/dverity/issues') errors.push('Package bugs URL must be the Dverity issue tracker');
}

function validateReadmes(errors, root) {
  const paths = ['README.md', 'README.zh-CN.md'];
  const readmes = paths.map((rel) => fs.existsSync(path.join(root, rel))
    ? fs.readFileSync(path.join(root, rel), 'utf8') : '');
  const required = ['# Dverity', 'Truth before main.', './DVERITY.md',
    '[![GitHub stars](https://img.shields.io/github/stars/Dimon94/dverity?style=social)](https://github.com/Dimon94/dverity)',
    'https://github.com/Dimon94/dverity', 'https://github.com/Dimon94/dverity/issues',
    'https://www.npmjs.com/package/dverity',
    'npx dverity@5 install'];
  for (const token of required) {
    if (readmes.some((text) => !text.includes(token))) errors.push(`README identity/link/install missing: ${token}`);
  }
}

function validateResidue(errors, root) {
  for (const file of walk(root).filter((entry) => isCurrentTextPath(relative(root, entry)))) {
    const rel = relative(root, file);
    if (LEGACY_CURRENT.some((pattern) => pattern.test(fs.readFileSync(file, 'utf8')))) {
      errors.push(`Old current brand/URL/community surface: ${rel}`);
    }
  }
  const typed = classifyLegacySurface({ root }).filter(({ type }) => type === 'current-doc');
  errors.push(...typed.map(({ path: rel }) => `Typed current-doc residue: ${rel}`));
}

function validateAssets(errors, root, packagedFiles) {
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (!isHistoryInputPath(rel) && COMMUNITY_ASSET.test(rel)) errors.push(`Current community/QR asset: ${rel}`);
  }
  for (const rel of packagedFiles) {
    if (COMMUNITY_ASSET.test(rel)) errors.push(`Packaged community/QR asset: ${rel}`);
  }
}

function validateHistory(errors, root, history) {
  for (const [rel, hash] of Object.entries(history)) {
    const target = path.join(root, rel);
    const changed = !fs.existsSync(target) || sha256(fs.readFileSync(target)) !== hash;
    if (changed) errors.push(`Historical record changed: ${rel}`);
  }
}

function validateCurrentSurface({ root, history = {}, packagedFiles = [] }) {
  const errors = [];
  validateLicense(errors, root);
  validatePackage(errors, root);
  validateReadmes(errors, root);
  validateResidue(errors, root);
  validateAssets(errors, root, packagedFiles);
  validateHistory(errors, root, history);
  return { success: errors.length === 0, errors: [...new Set(errors)].sort() };
}

module.exports = { captureHistory, licenseBodyHash, validateCurrentSurface };
