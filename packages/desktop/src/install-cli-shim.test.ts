import { describe, expect, it, vi } from 'vitest';
import path from 'path';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => path.join(process.cwd(), 'tmp-install-cli-shim-home'),
    isPackaged: false,
  },
  BrowserWindow: class {},
  Notification: class {},
  dialog: {},
}));

describe('install-cli-shim', () => {
  it('escapes Windows batch metacharacters in generated set values', async () => {
    const { escapeCmdSetValue } = await import('./install-cli-shim');

    expect(escapeCmdSetValue('C:\\Users\\A%TEMP%^B!C\\cli.js')).toBe(
      'C:\\Users\\A%%TEMP%%^^B^^!C\\cli.js',
    );
  });
});
