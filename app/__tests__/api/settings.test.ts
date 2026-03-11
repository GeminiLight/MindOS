import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/settings/route';
import { readSettings, writeSettings } from '../../lib/settings';

// The settings module is already mocked via setup.ts

describe('GET /api/settings', () => {
  it('returns settings with expected shape', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('ai');
    expect(body.ai).toHaveProperty('provider');
    expect(body.ai).toHaveProperty('providers');
    expect(body.ai.providers).toHaveProperty('anthropic');
    expect(body.ai.providers).toHaveProperty('openai');
    expect(body.ai.providers.anthropic).toHaveProperty('apiKey');
    expect(body.ai.providers.anthropic).toHaveProperty('model');
    expect(body.ai.providers.openai).toHaveProperty('apiKey');
    expect(body.ai.providers.openai).toHaveProperty('model');
    expect(body.ai.providers.openai).toHaveProperty('baseUrl');
    expect(body).toHaveProperty('mindRoot');
    expect(body).toHaveProperty('envOverrides');
    expect(body).toHaveProperty('envValues');
  });
});

describe('POST /api/settings', () => {
  it('calls writeSettings and returns ok', async () => {
    const req = new NextRequest('http://localhost/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        ai: {
          provider: 'openai',
          providers: {
            openai: { apiKey: 'sk-test', model: 'gpt-5.4', baseUrl: '' },
          },
        },
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(writeSettings).toHaveBeenCalled();
  });
});
