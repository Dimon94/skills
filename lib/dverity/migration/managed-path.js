const fs = require('fs');
const path = require('path');

function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safePath(root, relative) {
  const target = path.resolve(root, relative);
  if (!isInside(root, target)) throw new Error(`Path escapes selected root: ${relative}`);
  const segments = path.relative(root, target).split(path.sep);
  let cursor = root;
  segments.forEach((segment, index) => {
    cursor = path.join(cursor, segment);
    const stat = lstat(cursor);
    if (stat?.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${cursor}`);
    if (stat && index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Managed path parent is not a directory: ${cursor}`);
    }
  });
  return target;
}

module.exports = { safePath };
