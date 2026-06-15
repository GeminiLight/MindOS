import { describe, expect, it } from 'vitest';
import { parseMobilePairingPayload } from '@/lib/pairing-payload';

describe('parseMobilePairingPayload', () => {
  it('accepts a raw MindOS server URL', () => {
    expect(parseMobilePairingPayload(' http://192.168.1.10:4567/ ')).toEqual({
      ok: true,
      tokenFromUrl: false,
      payload: {
        url: 'http://192.168.1.10:4567',
        authToken: undefined,
        source: 'url',
      },
    });
  });

  it('extracts token query parameters without keeping them in the saved URL', () => {
    expect(parseMobilePairingPayload('http://192.168.1.10:4567?token=secret&view=mobile#pair')).toEqual({
      ok: true,
      tokenFromUrl: true,
      payload: {
        url: 'http://192.168.1.10:4567',
        authToken: 'secret',
        source: 'url',
      },
    });
  });

  it('accepts JSON payload aliases from desktop connection codes', () => {
    expect(parseMobilePairingPayload(JSON.stringify({
      serverUrl: 'https://mindos.local:4567/',
      apiToken: 'token-from-json',
    }))).toEqual({
      ok: true,
      tokenFromUrl: false,
      payload: {
        url: 'https://mindos.local:4567',
        authToken: 'token-from-json',
        source: 'json',
      },
    });
  });

  it('accepts mindos deep links', () => {
    const raw = 'mindos://connect?url=http%3A%2F%2F10.0.0.5%3A4567&authToken=deep-token';

    expect(parseMobilePairingPayload(raw)).toEqual({
      ok: true,
      tokenFromUrl: false,
      payload: {
        url: 'http://10.0.0.5:4567',
        authToken: 'deep-token',
        source: 'deep-link',
      },
    });
  });

  it('rejects non-MindOS payloads without guessing', () => {
    expect(parseMobilePairingPayload('mailto:test@example.com')).toEqual({
      ok: false,
      message: 'Scan a MindOS server URL or connection code.',
    });
    expect(parseMobilePairingPayload('{"token":"missing-url"}')).toEqual({
      ok: false,
      message: 'Scan a MindOS server URL or connection code.',
    });
  });
});
