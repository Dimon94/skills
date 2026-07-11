function decideSimplification(candidate) {
  if (candidate.deletable || candidate.speculative) {
    return { action: 'delete', reason: 'candidate behavior is unnecessary' };
  }
  if (candidate.native_replacement) {
    return { action: 'replace-native', reason: candidate.native_replacement };
  }
  if (candidate.stdlib_replacement) {
    return { action: 'replace-stdlib', reason: candidate.stdlib_replacement };
  }
  if (candidate.structural_risk) {
    return { action: 'repair-structure', reason: candidate.structural_risk };
  }
  if (candidate.test_seam_risk) {
    return { action: 'repair-test-seam', reason: candidate.test_seam_risk };
  }
  return { action: 'keep', reason: 'candidate is necessary and already simple' };
}

module.exports = {
  decideSimplification
};
