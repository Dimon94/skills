import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function smywScripts() {
  const directory = process.env.SMYW_DIR || join(homedir(), '.agents/skills/smyw');
  return {
    build: resolve(directory, 'scripts/build.mjs'),
    applyFeedback: resolve(directory, 'scripts/apply-feedback.mjs'),
  };
}
