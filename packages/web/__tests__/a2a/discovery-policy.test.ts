import { describe, it, expect } from 'vitest';
import {
  isPrivateNetworkHost,
  validateA2aDiscoveryUrl,
  validateA2aEndpointUrl,
} from '@/lib/a2a/discovery-policy';

describe('isPrivateNetworkHost', () => {
  describe('existing loopback / private / link-local detection', () => {
    it.each([
      'localhost',
      'LOCALHOST',
      'app.localhost',
      'printer.local',
      '127.0.0.1',
      '127.255.255.254',
      '0.0.0.0',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      '[::1]',
      '0:0:0:0:0:0:0:1',
      'fd00::1',
      'fc00::1',
      'fe80::1',
    ])('treats %s as private', (host) => {
      expect(isPrivateNetworkHost(host)).toBe(true);
    });

    it.each([
      '8.8.8.8',
      '1.1.1.1',
      '172.32.0.1',
      '11.0.0.1',
      'example.com',
      'agent.example',
      '2001:4860:4860::8888',
      '[2606:4700:4700::1111]',
    ])('treats %s as public', (host) => {
      expect(isPrivateNetworkHost(host)).toBe(false);
    });

    it('treats an empty hostname as private (fail closed)', () => {
      expect(isPrivateNetworkHost('')).toBe(true);
      expect(isPrivateNetworkHost('   ')).toBe(true);
    });
  });

  describe('IPv4-mapped IPv6 addresses', () => {
    it.each([
      '::ffff:127.0.0.1',
      '[::ffff:127.0.0.1]',
      '::FFFF:127.0.0.1',
      '::ffff:7f00:1',
      '[::ffff:7f00:1]',
      '::ffff:10.0.0.1',
      '::ffff:a00:1',
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '::ffff:192.168.1.10',
      '::ffff:c0a8:10a',
      '::ffff:0.0.0.0',
      '::ffff:0:0',
      '0:0:0:0:0:ffff:7f00:1',
      '0:0:0:0:0:ffff:127.0.0.1',
      '0000:0000:0000:0000:0000:ffff:7f00:0001',
      '0::ffff:7f00:1',
    ])('treats mapped private address %s as private', (host) => {
      expect(isPrivateNetworkHost(host)).toBe(true);
    });

    it.each([
      '::ffff:8.8.8.8',
      '::ffff:808:808',
      '[::ffff:808:808]',
      '::ffff:1.1.1.1',
      '0:0:0:0:0:ffff:808:808',
    ])('keeps mapped public address %s public', (host) => {
      expect(isPrivateNetworkHost(host)).toBe(false);
    });

    it('does not treat non-mapped IPv6 addresses with an ffff group as mapped', () => {
      // ffff appears, but not in the ::ffff:0:0/96 mapped prefix position.
      expect(isPrivateNetworkHost('2001:db8::ffff:7f00:1')).toBe(false);
      expect(isPrivateNetworkHost('ffff::7f00:1')).toBe(false);
    });

    it('rejects malformed mapped literals without throwing', () => {
      expect(isPrivateNetworkHost('::ffff:999.0.0.1')).toBe(false);
      expect(isPrivateNetworkHost('::ffff:7f00:1:2')).toBe(false);
      expect(isPrivateNetworkHost('::ffff::7f00:1')).toBe(false);
      expect(isPrivateNetworkHost('::ffff:zzzz:1')).toBe(false);
    });
  });

  describe('unspecified IPv6 address', () => {
    it.each(['::', '[::]', '0:0:0:0:0:0:0:0', '0::0', '::0'])('treats %s as private', (host) => {
      expect(isPrivateNetworkHost(host)).toBe(true);
    });
  });
});

describe('validateA2aDiscoveryUrl with IPv6 literals', () => {
  it('denies IPv4-mapped loopback literals by default', () => {
    expect(validateA2aDiscoveryUrl('http://[::ffff:127.0.0.1]:3456', {})).toEqual({
      ok: false,
      reason: 'private_network_not_allowed',
      message: expect.any(String),
    });
  });

  it('denies the hex form of the mapped loopback literal by default', () => {
    expect(validateA2aDiscoveryUrl('http://[::ffff:7f00:1]:3456', {})).toMatchObject({
      ok: false,
      reason: 'private_network_not_allowed',
    });
  });

  it('denies the mapped cloud-metadata literal by default', () => {
    expect(validateA2aDiscoveryUrl('http://[::ffff:169.254.169.254]', {})).toMatchObject({
      ok: false,
      reason: 'private_network_not_allowed',
    });
  });

  it('denies the unspecified IPv6 address by default', () => {
    expect(validateA2aDiscoveryUrl('http://[::]:3456', {})).toMatchObject({
      ok: false,
      reason: 'private_network_not_allowed',
    });
  });

  it('allows the mapped loopback literal when private networks are explicitly enabled', () => {
    const decision = validateA2aDiscoveryUrl('http://[::ffff:127.0.0.1]:3456', { allowPrivateNetwork: true });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.url).toBe('http://[::ffff:7f00:1]:3456');
      expect(decision.origin).toBe('http://[::ffff:7f00:1]:3456');
    }
  });

  it('still allows public IPv6 literals and hostnames', () => {
    expect(validateA2aDiscoveryUrl('http://[::ffff:8.8.8.8]:3456', {}).ok).toBe(true);
    expect(validateA2aDiscoveryUrl('https://[2001:4860:4860::8888]', {}).ok).toBe(true);
    expect(validateA2aDiscoveryUrl('https://agent.example', {}).ok).toBe(true);
  });
});

describe('validateA2aEndpointUrl with IPv6 literals', () => {
  it('denies IPv4-mapped loopback endpoints by default', () => {
    expect(validateA2aEndpointUrl('http://[::ffff:127.0.0.1]:3456/api/a2a', {})).toMatchObject({
      ok: false,
      reason: 'private_network_not_allowed',
    });
  });

  it('allows IPv4-mapped loopback endpoints when private networks are explicitly enabled', () => {
    const decision = validateA2aEndpointUrl('http://[::ffff:127.0.0.1]:3456/api/a2a', { allowPrivateNetwork: true });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.url).toBe('http://[::ffff:7f00:1]:3456/api/a2a');
  });

  it('keeps mapped public endpoints allowed', () => {
    expect(validateA2aEndpointUrl('https://[::ffff:8.8.8.8]/api/a2a', {}).ok).toBe(true);
  });
});
