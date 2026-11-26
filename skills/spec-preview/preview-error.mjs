/** @typedef {'InsideRepo' | 'NotConfirmed' | 'PreviewLockMismatch' | 'MissingEvidence' | 'CopyLint' | 'BLOCKED'} ErrorCode */

export class PreviewError extends Error {
  /** @param {ErrorCode} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
