import { PreviewError } from '../preview-error.mjs';

export function confirm(ref, feedback) {
  throw new PreviewError('BLOCKED', 'confirm 尚未实现');
}
