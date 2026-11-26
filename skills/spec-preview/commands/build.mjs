import { PreviewError } from '../preview-error.mjs';

export function build(ref) {
  throw new PreviewError('BLOCKED', 'build 尚未实现');
}
