const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  captureHistory,
  validateCurrentSurface
} = require('../lib/dverity/docs/current-surface');

const ROOT = path.resolve(__dirname, '..');

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-current-'));
  write(root, 'README.md', [
    '# Dverity',
    '',
    '> Truth before main.',
    '',
    '[Product contract](./DVERITY.md)',
    '[GitHub](https://github.com/Dimon94/dverity)',
    '[npm](https://www.npmjs.com/package/dverity)',
    '`npx dverity@5 install --project /path/to/project`'
  ].join('\n'));
  write(root, 'README.zh-CN.md', [
    '# Dverity', '', '> Truth before main.', '', '[产品契约](./DVERITY.md)',
    '[GitHub](https://github.com/Dimon94/dverity)',
    '[npm](https://www.npmjs.com/package/dverity)',
    '`npx dverity@5 install --project /path/to/project`'
  ].join('\n'));
  write(root, 'DVERITY.md', '# Dverity\n');
  write(root, 'LICENSE', [
    'MIT License',
    '',
    'Copyright (c) 2025 Dimon',
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.'
  ].join('\n'));
  write(root, 'package.json', JSON.stringify({
    name: 'dverity',
    version: '5.0.0',
    description: 'Truth before main.',
    repository: { type: 'git', url: 'git+https://github.com/Dimon94/dverity.git' },
    homepage: 'https://github.com/Dimon94/dverity#readme',
    bugs: { url: 'https://github.com/Dimon94/dverity/issues' }
  }));
  write(root, 'CHANGELOG.md', '# Historical release\n');
  write(root, 'docs/adr/0001-history.md', '# Historical ADR\n');
  write(root, 'devflow/changes/REQ-001/task.md', '# Historical task\n');
  write(root, 'docs/examples/demo/changes/REQ-001/task.md', '# Historical example task\n');
  return root;
}

test('accepts the complete canonical Dverity current surface', () => {
  const root = fixture();
  const history = captureHistory(root);

  expect(validateCurrentSurface({ root, history, packagedFiles: ['README.md', 'LICENSE'] }))
    .toEqual(expect.objectContaining({ success: true, errors: [] }));
});

test.each([
  ['old current repository URL', 'https://github.com/Dimon94/cc-devflow'],
  ['old current brand', 'CC-DevFlow'],
  ['community surface', 'Join the WeChat chat group'],
  ['QR surface', '<img src="docs/assets/wechat-group-qr.jpg">']
])('rejects %s even when the README title changed', (_label, residue) => {
  const root = fixture();
  fs.appendFileSync(path.join(root, 'README.md'), `\n${residue}\n`);

  expect(validateCurrentSurface({ root, history: captureHistory(root) }).success).toBe(false);
});

test('rejects a dead community asset in the package inventory', () => {
  const root = fixture();

  expect(validateCurrentSurface({
    root,
    history: captureHistory(root),
    packagedFiles: ['README.md', 'docs/assets/wechat-group-qr.jpg']
  }).errors).toContain('Packaged community/QR asset: docs/assets/wechat-group-qr.jpg');
});

test.each([
  ['POLICY.md', 'Current product: CC DevFlow'],
  ['.github/ISSUE_TEMPLATE/config.yml', 'blank_issues_enabled: https://github.com/Dimon94/cc-devflow/issues']
])('rejects old identity in newly added current surface %s', (relative, content) => {
  const root = fixture();
  write(root, relative, content);

  expect(validateCurrentSurface({ root, history: captureHistory(root) }).success).toBe(false);
});

test('requires canonical links and install command in both READMEs', () => {
  const root = fixture();
  write(root, 'README.zh-CN.md', '# Dverity\n\n> Truth before main.\n\n[产品契约](./DVERITY.md)\n');

  expect(validateCurrentSurface({ root, history: captureHistory(root) }).success).toBe(false);
});

test('rejects license body changes while allowing only the frozen notice', () => {
  const root = fixture();
  const license = path.join(root, 'LICENSE');
  fs.writeFileSync(license, fs.readFileSync(license, 'utf8').replace('Permission is hereby granted', 'Permission may be granted'));

  expect(validateCurrentSurface({ root, history: captureHistory(root) }).errors)
    .toContain('MIT license body semantics changed');
});

test('rejects broad replacement in historical records', () => {
  const root = fixture();
  const history = captureHistory(root);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Dverity release\n');

  expect(validateCurrentSurface({ root, history }).errors)
    .toContain('Historical record changed: CHANGELOG.md');
});

test('repository current surface satisfies DV-DOC-003', () => {
  const result = validateCurrentSurface({ root: ROOT, history: captureHistory(ROOT) });

  expect(result.errors).toEqual([]);
});
