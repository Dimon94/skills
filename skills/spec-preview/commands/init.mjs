import { PreviewError } from '../preview-error.mjs';

export function init(ref) {
  throw new PreviewError('BLOCKED', 'init 尚未实现');
}
