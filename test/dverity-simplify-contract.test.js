const {
  decideSimplification
} = require('../skills/dverity-simplify/references/simplification-rules');

describe('dverity-simplify behavioral contract', () => {
  test.each([
    ['deletable code', { deletable: true }, 'delete'],
    ['speculative code', { speculative: true }, 'delete'],
    ['native replacement', { native_replacement: 'URL' }, 'replace-native'],
    ['standard-library replacement', { stdlib_replacement: 'node:path' }, 'replace-stdlib'],
    ['structural risk', { structural_risk: 'mixed responsibilities' }, 'repair-structure'],
    ['test seam risk', { test_seam_risk: 'private-method assertion' }, 'repair-test-seam'],
    ['necessary simple code', {}, 'keep']
  ])('chooses the minimum safe action for %s', (_name, candidate, action) => {
    expect(decideSimplification(candidate)).toEqual(expect.objectContaining({ action }));
  });

  test('deletion-first wins over structural rewriting', () => {
    expect(decideSimplification({
      deletable: true,
      structural_risk: 'large module',
      test_seam_risk: 'internal mock'
    })).toEqual({ action: 'delete', reason: 'candidate behavior is unnecessary' });
  });
});
