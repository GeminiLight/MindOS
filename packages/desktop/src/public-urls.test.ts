import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { MINDOS_DOCUMENTATION_URL, MINDOS_DOWNLOAD_URL, MINDOS_SITE_URL } from './public-urls';

describe('desktop public URLs', () => {
  it('opens the current MindOS site from documentation and download surfaces', () => {
    expect(MINDOS_SITE_URL).toBe('https://mindos.you');
    expect(MINDOS_DOCUMENTATION_URL).toBe(MINDOS_SITE_URL);
    expect(MINDOS_DOWNLOAD_URL).toBe(`${MINDOS_SITE_URL}#quickstart`);
  });

  it('does not keep stale mindos.app public links in desktop source', () => {
    for (const file of ['app-menu.ts', 'install-cli-shim.ts', 'public-urls.ts']) {
      const source = readFileSync(path.join(__dirname, file), 'utf-8');
      expect(source).not.toContain('mindos.app');
    }
  });
});
