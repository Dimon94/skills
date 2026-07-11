const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveRuntimeConfig } = require('../runtime-config');

function tempRoot(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('Dverity runtime and durable-data namespace', () => {
  test('runtime reads only .dverity and DVERITY_* when legacy inputs conflict', () => {
    const homeDir = tempRoot('dverity-runtime-home-');
    const projectRoot = tempRoot('dverity-runtime-project-');
    write(path.join(homeDir, '.cc-devflow/config.yml'), 'output:\n  document_language: en\n');
    write(path.join(projectRoot, '.cc-devflow/config.local.yml'), 'output:\n  document_language: en\n');
    write(path.join(homeDir, '.dverity/config.yml'), 'agent_preferences:\n  tone: concise\n');
    write(path.join(projectRoot, '.dverity/config.yml'), 'output:\n  document_language: en\n');
    const reads = [];

    const resolved = resolveRuntimeConfig({
      projectRoot,
      homeDir,
      env: {
        CC_DEVFLOW_DOCUMENT_LANGUAGE: 'en',
        DVERITY_DOCUMENT_LANGUAGE: 'zh-CN'
      },
      onRead: (entry) => reads.push(entry)
    });

    expect(resolved.config).toMatchObject({
      output: { document_language: 'zh-CN' },
      agent_preferences: { tone: 'concise' }
    });
    expect(reads.filter(({ kind }) => kind === 'config').map(({ path: file }) => file))
      .toEqual([
        path.join(homeDir, '.dverity/config.yml'),
        path.join(projectRoot, '.dverity/config.yml'),
        path.join(projectRoot, '.dverity/config.local.yml')
      ]);
    expect(reads.filter(({ kind }) => kind === 'env').map(({ key }) => key))
      .toEqual(['DVERITY_DOCUMENT_LANGUAGE']);
    expect(JSON.stringify(reads)).not.toMatch(/cc-devflow|CC_DEVFLOW/);
  });

  test('legacy-only config and env are equivalent to absent input', () => {
    const homeDir = tempRoot('dverity-runtime-old-home-');
    const projectRoot = tempRoot('dverity-runtime-old-project-');
    write(path.join(homeDir, '.cc-devflow/config.yml'), 'output:\n  document_language: zh-CN\n');
    write(path.join(projectRoot, '.cc-devflow/config.local.yml'), 'agent_preferences:\n  old: true\n');

    const resolved = resolveRuntimeConfig({
      projectRoot,
      homeDir,
      env: { CC_DEVFLOW_DOCUMENT_LANGUAGE: 'zh-CN' }
    });

    expect(resolved).toMatchObject({
      enabled: false,
      config: {
        version: 1,
        output: { document_language: 'en' },
        agent_preferences: {}
      }
    });
    expect(JSON.stringify(resolved.reads)).not.toMatch(/cc-devflow|CC_DEVFLOW/);
  });

  test.each(['namespace', 'config file'])('%s symlink cannot disguise a legacy read', (kind) => {
    const homeDir = tempRoot('dverity-runtime-link-home-');
    const projectRoot = tempRoot('dverity-runtime-link-project-');
    const legacyRoot = path.join(projectRoot, '.cc-devflow');
    write(path.join(legacyRoot, 'config.yml'), 'output:\n  document_language: zh-CN\n');
    if (kind === 'namespace') {
      fs.symlinkSync('.cc-devflow', path.join(projectRoot, '.dverity'));
    } else {
      fs.mkdirSync(path.join(projectRoot, '.dverity'));
      fs.symlinkSync('../.cc-devflow/config.yml', path.join(projectRoot, '.dverity/config.yml'));
    }
    const reads = [];

    expect(() => resolveRuntimeConfig({
      projectRoot,
      homeDir,
      env: {},
      onRead: (entry) => reads.push(entry)
    })).toThrow(/symlink/i);
    expect(reads.some(({ path: file }) => file?.startsWith(path.join(projectRoot, '.dverity'))))
      .toBe(false);
  });
});
