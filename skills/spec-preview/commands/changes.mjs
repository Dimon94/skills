import { PreviewError } from '../preview-error.mjs';

export function changes(ref, lock) {
  throw new PreviewError('BLOCKED', 'changes 尚未实现');
}
