const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildSkillProvenance,
  enumerateSkillSource,
  validateSkillProvenance
} = require('../lib/dverity/skill-source');

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
      'lib/dverity/host-discovery.js',
      'lib/dverity/host-projections.js',
      'lib/dverity/lifecycle.js',
      'lib/dverity/package-provenance.json',
      'lib/dverity/skill-source.js',
      'scripts/verify-host-discovery.js'
    ]));
    expect(packedFiles.some((file) => file.includes('cc-devflow'))).toBe(false);
    expect(packed.package.files.every((file) => packedFiles.includes(file))).toBe(true);
    expect(packed.source.source_hash).toBe(source.source_hash);
    expect(packed.source.skills).toEqual(source.skills);
    expect(validateSkillProvenance(packed)).toEqual({ success: true });

    const help = spawnSync(process.execPath, ['bin/dverity.js', '--help'], {
      cwd: packedRoot,
      encoding: 'utf8'
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('dverity <command>');

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
      path.join(packedRoot, 'lib/dverity/package-provenance.json'),
      'utf8'
    ));
    expect(manifest.source.commit).toBe(provenance.source_commit);
  });
});
