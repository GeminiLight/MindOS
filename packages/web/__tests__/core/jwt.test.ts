import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '@/lib/jwt';

describe('signJwt + verifyJwt', () => {
  const secret = 'test-secret-key-1234';

  it('signs and verifies a simple payload', async () => {
    const payload = { sub: 'user-123', role: 'admin' };
    const token = await signJwt(payload, secret);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const verified = await verifyJwt(token, secret);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe('user-123');
    expect(verified!.role).toBe('admin');
  });

  it('returns null for invalid token format', async () => {
    expect(await verifyJwt('not-a-jwt', secret)).toBeNull();
    expect(await verifyJwt('a.b', secret)).toBeNull();
    expect(await verifyJwt('', secret)).toBeNull();
  });

  it('returns null for wrong secret', async () => {
    const token = await signJwt({ sub: 'test' }, secret);
    const verified = await verifyJwt(token, 'wrong-secret');
    expect(verified).toBeNull();
  });

  it('returns null for expired token', async () => {
    const payload = { sub: 'test', exp: Math.floor(Date.now() / 1000) - 3600 };
    const token = await signJwt(payload, secret);
    const verified = await verifyJwt(token, secret);
    expect(verified).toBeNull();
  });

  it('accepts non-expired token', async () => {
    const payload = { sub: 'test', exp: Math.floor(Date.now() / 1000) + 3600 };
    const token = await signJwt(payload, secret);
    const verified = await verifyJwt(token, secret);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe('test');
  });

  it('handles payload with special characters', async () => {
    const payload = { name: '日本語テスト 🎉', path: '/a/b/c' };
    const token = await signJwt(payload, secret);
    const verified = await verifyJwt(token, secret);
    expect(verified).not.toBeNull();
    expect(verified!.name).toBe('日本語テスト 🎉');
    expect(verified!.path).toBe('/a/b/c');
  });

  it('handles empty payload', async () => {
    const token = await signJwt({}, secret);
    const verified = await verifyJwt(token, secret);
    expect(verified).not.toBeNull();
    expect(verified).toEqual({});
  });
});
