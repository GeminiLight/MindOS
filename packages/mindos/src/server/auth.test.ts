import { describe, expect, it } from 'vitest';
import {
  allowsSameOriginExemption,
  forwardedClientAddresses,
  forwardedClientIsRemote,
  isAuthorizedRequest,
  isLoopbackAddress,
  isLoopbackHost,
} from './auth.js';

const services = (settings: { authToken?: string; webPassword?: string }) => ({
  readSettings: () => ({ mindRoot: '/tmp/mind', ...settings }) as never,
});

describe('isLoopbackAddress', () => {
  it.each([
    '127.0.0.1',
    '127.0.0.2',
    '127.255.255.254',
    '::1',
    '::ffff:127.0.0.1',
    '::FFFF:127.0.0.1',
    '::ffff:7f00:1',
    '::1%lo0',
  ])('treats %s as loopback', (address) => {
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it.each([
    '192.168.1.20',
    '10.0.0.5',
    '172.17.0.1',
    '128.0.0.1',
    '::ffff:192.168.1.20',
    '::2',
    'fe80::1',
    '',
    '   ',
    'localhost',
    '127.0.0.1.evil',
    undefined,
    null,
  ])('rejects %s', (address) => {
    expect(isLoopbackAddress(address as string | null | undefined)).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'localhost:3456',
    'Localhost:65535',
    '127.0.0.1',
    '127.0.0.1:8080',
    '[::1]',
    '[::1]:4567',
  ])('accepts Host %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    '192.168.1.5:3456',
    'localhost.evil.com',
    'localhost.evil.com:3456',
    'evil.com:localhost',
    '127.0.0.1.nip.io',
    'notlocalhost',
    '[::2]:3456',
    '::1',
    'localhost:',
    'localhost:abc',
    'localhost:3456:1',
    'localhost/',
    '',
    undefined,
    null,
  ])('rejects Host %s', (host) => {
    expect(isLoopbackHost(host as string | null | undefined)).toBe(false);
  });
});

describe('forwardedClientAddresses / forwardedClientIsRemote', () => {
  it('finds no addresses on a direct request', () => {
    const headers = new Headers({ host: 'localhost:3456' });
    expect(forwardedClientAddresses(headers)).toEqual([]);
    expect(forwardedClientIsRemote(headers)).toBe(false);
  });

  it('parses X-Forwarded-For chains, Forwarded for= nodes and X-Real-IP', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.9, 10.0.0.2:8080',
      forwarded: 'for=192.0.2.60;proto=http;by=203.0.113.43, for="[2001:db8::1]:4711"',
      'x-real-ip': '198.51.100.7',
    });
    expect(forwardedClientAddresses(headers)).toEqual(['203.0.113.9', '10.0.0.2', '192.0.2.60', '2001:db8::1', '198.51.100.7']);
    expect(forwardedClientIsRemote(headers)).toBe(true);
  });

  it('treats a loopback-only chain as local (Next fills X-Forwarded-For from the socket)', () => {
    for (const value of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.1, ::1']) {
      expect(forwardedClientIsRemote(new Headers({ 'x-forwarded-for': value })), value).toBe(false);
    }
    expect(forwardedClientIsRemote(new Headers({ forwarded: 'for="[::1]:4711"' }))).toBe(false);
    expect(forwardedClientIsRemote(new Headers({ 'x-real-ip': '127.0.0.1' }))).toBe(false);
  });

  it.each(['203.0.113.9', '127.0.0.1, 203.0.113.9', 'unknown', '_hidden', '   , 192.168.1.20'])('flags %s as remote', (value) => {
    expect(forwardedClientIsRemote(new Headers({ 'x-forwarded-for': value }))).toBe(true);
  });

  it('ignores empty forwarded headers', () => {
    expect(forwardedClientIsRemote(new Headers({ 'x-forwarded-for': '   ' }))).toBe(false);
    expect(forwardedClientAddresses(new Headers({ 'x-real-ip': '' }))).toEqual([]);
  });
});

describe('allowsSameOriginExemption', () => {
  it('allows a loopback socket regardless of Host', () => {
    expect(allowsSameOriginExemption({ headers: new Headers({ host: '192.168.1.5:3456' }), remoteAddress: '127.0.0.1' })).toBe(true);
    expect(allowsSameOriginExemption({ headers: new Headers(), remoteAddress: '::1' })).toBe(true);
  });

  it('allows a localhost Host when the socket address is unknown or bridged', () => {
    expect(allowsSameOriginExemption({ headers: new Headers({ host: 'localhost:3456' }) })).toBe(true);
    expect(allowsSameOriginExemption({ headers: new Headers({ host: '[::1]:3456' }), remoteAddress: '172.17.0.1' })).toBe(true);
  });

  it('rejects a LAN browser that loaded the UI over the LAN address', () => {
    expect(allowsSameOriginExemption({ headers: new Headers({ host: '192.168.1.5:3456' }), remoteAddress: '192.168.1.20' })).toBe(false);
    expect(allowsSameOriginExemption({ headers: new Headers({ host: '192.168.1.5:3456' }) })).toBe(false);
    expect(allowsSameOriginExemption({ headers: new Headers(), remoteAddress: '192.168.1.20' })).toBe(false);
  });

  it('rejects a remote client reported by a reverse proxy, even when the socket peer is loopback', () => {
    expect(allowsSameOriginExemption({
      headers: new Headers({ host: 'localhost:3456', 'x-forwarded-for': '203.0.113.9' }),
      remoteAddress: '127.0.0.1',
    })).toBe(false);
    expect(allowsSameOriginExemption({
      headers: new Headers({ host: 'localhost:3456', forwarded: 'for=203.0.113.9' }),
    })).toBe(false);
  });

  it('keeps a local browser behind the Next proxy, whose X-Forwarded-For is the loopback socket', () => {
    expect(allowsSameOriginExemption({
      headers: new Headers({ host: 'localhost:3000', 'x-forwarded-for': '::ffff:127.0.0.1' }),
    })).toBe(true);
    // A loopback forwarded chain never allows on its own: Host still decides.
    expect(allowsSameOriginExemption({
      headers: new Headers({ host: '192.168.1.5:3000', 'x-forwarded-for': '127.0.0.1' }),
    })).toBe(false);
  });
});

describe('isAuthorizedRequest same-origin exemption', () => {
  const sameOrigin = (extra: Record<string, string> = {}) => new Headers({ 'sec-fetch-site': 'same-origin', ...extra });
  const token = services({ authToken: 'secret-token' });

  it('keeps trusting a same-origin browser on loopback while no Web password exists', () => {
    expect(isAuthorizedRequest({ auth: 'required', headers: sameOrigin({ host: '127.0.0.1:3456' }), remoteAddress: '127.0.0.1', services: token })).toBe(true);
  });

  it('trusts a same-origin browser by localhost Host when the socket is unknown', () => {
    expect(isAuthorizedRequest({ auth: 'required', headers: sameOrigin({ host: 'localhost:3456' }), services: token })).toBe(true);
  });

  it('no longer trusts a same-origin browser from another machine', () => {
    expect(isAuthorizedRequest({
      auth: 'required',
      headers: sameOrigin({ host: '192.168.1.5:3456' }),
      remoteAddress: '192.168.1.20',
      services: token,
    })).toBe(false);
  });

  it('no longer trusts a same-origin browser behind a reverse proxy', () => {
    expect(isAuthorizedRequest({
      auth: 'required',
      headers: sameOrigin({ host: 'localhost:3456', 'x-forwarded-for': '203.0.113.9' }),
      remoteAddress: '127.0.0.1',
      services: token,
    })).toBe(false);
  });

  it('still requires the bearer once a Web password exists', () => {
    const locked = services({ authToken: 'secret-token', webPassword: 'pw' });
    expect(isAuthorizedRequest({ auth: 'required', headers: sameOrigin({ host: 'localhost:3456' }), remoteAddress: '127.0.0.1', services: locked })).toBe(false);
    expect(isAuthorizedRequest({
      auth: 'required',
      headers: new Headers({ authorization: 'Bearer secret-token', host: '192.168.1.5:3456' }),
      remoteAddress: '192.168.1.20',
      services: locked,
    })).toBe(true);
  });

  it('accepts the bearer from any address', () => {
    expect(isAuthorizedRequest({
      auth: 'required',
      headers: new Headers({ authorization: 'Bearer secret-token', host: '192.168.1.5:3456' }),
      remoteAddress: '192.168.1.20',
      services: token,
    })).toBe(true);
  });

  it('leaves public routes and open deployments untouched', () => {
    expect(isAuthorizedRequest({ auth: 'public', headers: new Headers(), remoteAddress: '192.168.1.20', services: token })).toBe(true);
    expect(isAuthorizedRequest({ auth: 'required', headers: new Headers(), remoteAddress: '192.168.1.20', services: services({}) })).toBe(true);
  });
});
