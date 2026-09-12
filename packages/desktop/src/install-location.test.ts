import { describe, expect, it, vi } from 'vitest';
import { ensureInstallLocation } from './install-location';
function options(exe = '/Volumes/MindOS/MindOS.app/Contents/MacOS/MindOS') {
  return { platform: 'darwin', packaged: true, exe, locale:'en', smoke:false, move:vi.fn(() => true), prompt:vi.fn(async () => 0), showError:vi.fn(async () => {}), quit:vi.fn() };
}
describe('macOS temporary install location', () => {
  it('moves a mounted DMG app before startup writes any CLI paths', async () => {
    const opts = options(); expect(await ensureInstallLocation(opts)).toBe(false); expect(opts.move).toHaveBeenCalledOnce();
  });
  it('allows a deliberate portable launch or a custom writable installation', async () => {
    const opts = options(); opts.prompt.mockResolvedValue(1);
    expect(await ensureInstallLocation(opts)).toBe(true);
    const custom = options('/Users/me/Apps/MindOS.app/Contents/MacOS/MindOS');
    expect(await ensureInstallLocation(custom)).toBe(true); expect(custom.prompt).not.toHaveBeenCalled();
  });
  it('explains a failed move and stops startup without changing user data', async () => {
    const opts = options(); opts.move.mockImplementation(() => {throw new Error('Permission denied')});
    expect(await ensureInstallLocation(opts)).toBe(false); expect(opts.showError).toHaveBeenCalledWith(expect.stringContaining('Permission denied')); expect(opts.quit).toHaveBeenCalled();
  });
  it('leaves test runs and other operating systems alone', async () => {
    const opts = {...options(),smoke:true}; expect(await ensureInstallLocation(opts)).toBe(true); expect(opts.move).not.toHaveBeenCalled();
    expect(await ensureInstallLocation({...options(),platform:'win32'})).toBe(true);
  });
});
