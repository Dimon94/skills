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
      'pack', '--json', '--ignore-scripts', '--pack-destination', tmp
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
    expect(packed.package.files.every((file) => packedFiles.includes(file))).toBe(true);
    expect(packed.source.source_hash).toBe(source.source_hash);
    expect(packed.source.skills).toEqual(source.skills);
    expect(validateSkillProvenance(packed)).toEqual({ success: true });
  });
});
