import { describe, expect, it } from 'vitest';
import { checkRemoteCompat } from './remote-compat';

describe('remote server compatibility gate', () => {
  it('passes when no minimum is configured', () => {
    expect(checkRemoteCompat({ serverVersion: '0.1.0', minVersion: undefined })).toEqual({ ok: true });
    expect(checkRemoteCompat({ serverVersion: '0.1.0', minVersion: '' })).toEqual({ ok: true });
    expect(checkRemoteCompat({ serverVersion: '0.1.0', minVersion: '   ' })).toEqual({ ok: true });
  });

  it('rejects a server below the configured minimum', () => {
    expect(checkRemoteCompat({ serverVersion: '0.5.0', minVersion: '0.6.0' })).toEqual({
      ok: false,
      reason: 'below-min',
      serverVersion: '0.5.0',
      minVersion: '0.6.0',
    });
  });

  it('accepts a server at or above the minimum', () => {
    expect(checkRemoteCompat({ serverVersion: '0.6.0', minVersion: '0.6.0' })).toEqual({ ok: true });
    expect(checkRemoteCompat({ serverVersion: '1.0.0', minVersion: '0.6.0' })).toEqual({ ok: true });
  });

  it('tolerates a leading v on the reported server version', () => {
    expect(checkRemoteCompat({ serverVersion: 'v0.5.0', minVersion: '0.6.0' })).toMatchObject({ ok: false });
    expect(checkRemoteCompat({ serverVersion: 'v0.7.0', minVersion: '0.6.0' })).toEqual({ ok: true });
  });

  it('does not block servers that report no version or an unparsable one', () => {
    expect(checkRemoteCompat({ serverVersion: undefined, minVersion: '0.6.0' })).toEqual({ ok: true });
    expect(checkRemoteCompat({ serverVersion: null, minVersion: '0.6.0' })).toEqual({ ok: true });
    expect(checkRemoteCompat({ serverVersion: 'nightly', minVersion: '0.6.0' })).toEqual({ ok: true });
    expect(checkRemoteCompat({ serverVersion: '', minVersion: '0.6.0' })).toEqual({ ok: true });
  });

  it('ignores an unparsable minimum rather than blocking every server', () => {
    expect(checkRemoteCompat({ serverVersion: '0.1.0', minVersion: 'latest' })).toEqual({ ok: true });
  });

  it('compares numerically, not lexicographically', () => {
    expect(checkRemoteCompat({ serverVersion: '0.10.0', minVersion: '0.9.0' })).toEqual({ ok: true });
  });
});
