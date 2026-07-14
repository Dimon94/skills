const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildSkillProvenance,
  enumerateSkillSource,
  validateSkillProvenance
} = require('../lib/dverity/install/skill-source');

const ROOT = path.resolve(__dirname, '..');

describe('Dverity packed Skill source', () => {
  test('preserves exact inventory, source hash, and projection provenance', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-pack-'));
    const pack = spawnSync('npm', [
      'pack', '--json', '--pack-destination', tmp
    ], { cwd: ROOT, encoding: 'utf8' });

    expect(pack.status).toBe(0);
    const metadata = JSON.parse(pack.stdout)[0];
    expect({ name: metadata.name, version: metadata.version })
      .toEqual({ name: 'dverity', version: '5.0.0' });
    expect(metadata.files.map((file) => file.path).some((file) => file.includes('__tests__')))
      .toBe(false);

    const unpack = spawnSync('tar', [
      '-xzf', path.join(tmp, metadata.filename), '-C', tmp
    ], { encoding: 'utf8' });
    expect(unpack.status).toBe(0);

    const packedRoot = path.join(tmp, 'package');
    const source = enumerateSkillSource({ root: ROOT });
    const packed = buildSkillProvenance({ root: packedRoot });
    const packedFiles = metadata.files.map((file) => file.path);
    expect(packedFiles).toEqual(expect.arrayContaining([
      'bin/dverity.js',
      'bin/dverity-cli.js',
      'config/managed-downstreams.json',
      'lib/dverity/downstream-sync/index.js',
      'lib/dverity/install/host-discovery.js',
      'lib/dverity/install/host-projections.js',
      'lib/dverity/legacy/classifier.js',
      'lib/dverity/install/lifecycle.js',
      'lib/dverity/migration/data.js',
      'lib/dverity/migration/managed-path.js',
      'lib/dverity/migration/owned-paths.js',
      'lib/dverity/migration/transaction-schema.json',
      'lib/dverity/release/package-provenance.json',
      'lib/dverity/install/runtime-config.js',
      'lib/dverity/install/skill-source.js',
      'scripts/verify-host-discovery.js'
    ]));
    expect(packedFiles.some((file) => file.includes('cc-devflow'))).toBe(false);
    expect(packed.package.files.every((file) => packedFiles.includes(file))).toBe(true);
    expect(packed.source.source_hash).toBe(source.source_hash);
    expect(packed.source.skills).toEqual(source.skills);
    expect(validateSkillProvenance(packed)).toEqual({ success: true });

    const runtimeHome = path.join(tmp, 'runtime-home');
    const runtimeProject = path.join(tmp, 'runtime-project');
    fs.mkdirSync(path.join(runtimeHome, '.cc-devflow'), { recursive: true });
    fs.mkdirSync(path.join(runtimeProject, '.dverity'), { recursive: true });
    fs.writeFileSync(
      path.join(runtimeHome, '.cc-devflow/config.yml'),
      'output:\n  document_language: en\n'
    );
    fs.writeFileSync(
      path.join(runtimeProject, '.dverity/config.yml'),
      'output:\n  document_language: zh-CN\n'
    );
    const runtimeModule = path.join(packedRoot, 'lib/dverity/install/runtime-config.js');
    const runtimeProbe = spawnSync(process.execPath, ['-e', `
      const { resolveRuntimeConfig } = require(${JSON.stringify(runtimeModule)});
      const reads = [];
      const result = resolveRuntimeConfig({
        homeDir: ${JSON.stringify(runtimeHome)},
        projectRoot: ${JSON.stringify(runtimeProject)},
        env: { CC_DEVFLOW_DOCUMENT_LANGUAGE: 'en', DVERITY_DOCUMENT_LANGUAGE: 'zh-CN' },
        onRead: (entry) => reads.push(entry)
      });
      process.stdout.write(JSON.stringify({ config: result.config, reads }));
    `], {
      cwd: packedRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') }
    });
    expect(runtimeProbe.status).toBe(0);
    const runtimeReadback = JSON.parse(runtimeProbe.stdout);
    expect(runtimeReadback.config.output.document_language).toBe('zh-CN');
    expect(JSON.stringify(runtimeReadback.reads)).not.toMatch(/cc-devflow|CC_DEVFLOW/);

    const help = spawnSync(process.execPath, ['bin/dverity.js', '--help'], {
      cwd: packedRoot,
      encoding: 'utf8'
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('dverity <command>');

    const submitLoad = spawnSync(process.execPath, ['-e', "require('./lib/dverity/review/submit')"], {
      cwd: packedRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') }
    });
    expect(submitLoad.status).toBe(0);

    const installRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-packed-install-'))
    );
    const install = spawnSync(process.execPath, ['bin/dverity.js', 'install', '--project', installRoot], {
      cwd: packedRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') }
    });
    expect(install.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(
      path.join(installRoot, '.dverity/managed-skills.json'),
      'utf8'
    ));
    const provenance = JSON.parse(fs.readFileSync(
      path.join(packedRoot, 'lib/dverity/release/package-provenance.json'),
      'utf8'
    ));
    expect(manifest.source.commit).toBe(provenance.source_commit);
  });
});
