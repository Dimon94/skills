import { PreviewError } from '../preview-error.mjs';

export function delta(ref, items) {
  throw new PreviewError('BLOCKED', 'delta 尚未实现');
}
