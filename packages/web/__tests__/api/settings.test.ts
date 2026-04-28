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
    expect(body.ai).toHaveProperty('activeProvider');
    expect(body.ai).toHaveProperty('providers');
    expect(Array.isArray(body.ai.providers)).toBe(true);
    expect(body.ai.providers.length).toBeGreaterThanOrEqual(1);
    const anthropic = body.ai.providers.find((p: any) => p.protocol === 'anthropic');
    const openai = body.ai.providers.find((p: any) => p.protocol === 'openai');
    expect(anthropic).toBeDefined();
    expect(anthropic).toHaveProperty('apiKey');
    expect(anthropic).toHaveProperty('model');
    expect(openai).toBeDefined();
    expect(openai).toHaveProperty('apiKey');
    expect(openai).toHaveProperty('model');
    expect(openai).toHaveProperty('baseUrl');
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
          activeProvider: 'p_openai01',
          providers: [
            { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-test', model: 'gpt-5.4', baseUrl: '' },
          ],
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
