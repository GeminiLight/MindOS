import { describe, expect, it } from 'vitest';
import { isRuntimeDocumentationFileName } from '../../scripts/runtime-package-pruning.mjs';

describe('runtime package documentation pruning', () => {
  it('removes documentation files without deleting executable modules with documentation-like basenames', () => {
    for (const name of ['README', 'README.md', 'CHANGELOG.md', 'history.txt', 'SECURITY.rst']) {
      expect(isRuntimeDocumentationFileName(name), `${name} should be pruned`).toBe(true);
    }

    for (const name of ['changelog.js', 'history.mjs', 'security.cjs', 'readme.ts']) {
      expect(isRuntimeDocumentationFileName(name), `${name} is runtime code`).toBe(false);
    }
  });
});
