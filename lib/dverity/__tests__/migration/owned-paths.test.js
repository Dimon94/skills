const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createMigrationTransfers,
  forwardOwnedTransfer
} = require('../../migration/owned-paths');

function tempRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-owned-paths-')));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function publishFixture() {
  const root = tempRoot();
  const stageRoot = tempRoot();
  const skill = path.join(stageRoot, '.agents/skills/dverity-repair');
  write(path.join(skill, 'a.txt'), 'a\n');
  write(path.join(skill, 'b.txt'), 'b\n');
  const transfers = createMigrationTransfers({
    root,
    backupRoot: tempRoot(),
    stageRoot,
    legacySkills: [],
    dveritySkills: ['dverity-repair'],
    legacyMarkerPath: '.codex/.cc-devflow-managed-skills.json'
  });
  return { root, skill, transfer: transfers.publishAgents };
}

describe('owned migration transfers', () => {
  test('does not replace an empty same-name directory arriving at reservation', () => {
    const { root, skill, transfer } = publishFixture();
    const collision = path.join(root, '.agents/skills/dverity-repair');
    const parent = path.dirname(collision);
    const mkdir = fs.mkdirSync.bind(fs);
    let injected = false;
    const spy = jest.spyOn(fs, 'mkdirSync').mockImplementation((target, options) => {
      if (!injected && target === parent) {
        injected = true;
        mkdir(collision, { recursive: true });
      }
      return mkdir(target, options);
    });

    try {
      expect(() => forwardOwnedTransfer(transfer)).toThrow(/EEXIST/i);
    } finally {
      spy.mockRestore();
    }

    expect(injected).toBe(true);
    expect(fs.readdirSync(collision)).toEqual([]);
    expect(fs.readFileSync(path.join(skill, 'a.txt'), 'utf8')).toBe('a\n');
  });

  test('keeps the complete source when the second file copy fails', () => {
    const { root, skill, transfer } = publishFixture();
    const copyFile = fs.copyFileSync.bind(fs);
    let copies = 0;
    const spy = jest.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, mode) => {
      copies += 1;
      if (copies === 2) throw new Error('injected owned copy EIO');
      return copyFile(source, destination, mode);
    });

    try {
      expect(() => forwardOwnedTransfer(transfer)).toThrow('injected owned copy EIO');
    } finally {
      spy.mockRestore();
    }

    expect(fs.readFileSync(path.join(skill, 'a.txt'), 'utf8')).toBe('a\n');
    expect(fs.readFileSync(path.join(skill, 'b.txt'), 'utf8')).toBe('b\n');
    expect(fs.existsSync(path.join(root, '.agents/skills/dverity-repair'))).toBe(false);
  });
});
