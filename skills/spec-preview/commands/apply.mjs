import { PreviewError } from '../preview-error.mjs';

export function apply(ref, feedback) {
  throw new PreviewError('BLOCKED', 'apply 尚未实现');
}
