import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

// We need a real temp dir for skill file operations
let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-skill-test-'));
  process.env.MIND_ROOT = tempRoot;
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.MIND_ROOT;
});

// Must import after env setup — dynamic import to avoid caching
async function importRoute() {
  // Clear module cache to pick up fresh MIND_ROOT
  const mod = await import('../../app/api/skills/route');
  return mod;
}

describe('GET /api/skills', () => {
  it('returns an array of skills', async () => {
    const { GET } = await importRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('skills');
    expect(Array.isArray(body.skills)).toBe(true);
  });

  it('detects user skills from {mindRoot}/.skills/', async () => {
    // Seed a user skill
    const skillDir = path.join(tempRoot, '.skills', 'my-test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: my-test-skill\ndescription: A test skill\n---\n\nHello', 'utf-8');

    const { GET } = await importRoute();
    const res = await GET();
    const body = await res.json();
    const userSkill = body.skills.find((s: { name: string }) => s.name === 'my-test-skill');
    expect(userSkill).toBeDefined();
    expect(userSkill.source).toBe('user');
    expect(userSkill.editable).toBe(true);
    expect(userSkill.description).toBe('A test skill');
  });
});

describe('POST /api/skills — path traversal', () => {
  it('rejects name with path traversal characters', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: '../../../etc/passwd' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid skill name/i);
  });

  it('rejects name with uppercase letters', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: 'MySkill' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects name with spaces', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: 'my skill' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects name starting with hyphen', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: '-bad-name' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('accepts valid lowercase-hyphen name', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: 'my-cool-skill', description: 'test' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify file was created
    const skillFile = path.join(tempRoot, '.skills', 'my-cool-skill', 'SKILL.md');
    expect(fs.existsSync(skillFile)).toBe(true);
  });
});

describe('POST /api/skills — CRUD', () => {
  it('creates a skill and reads it back', async () => {
    const { GET, POST } = await importRoute();

    // Create
    const createReq = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: 'test-crud', description: 'CRUD test' }),
      headers: { 'content-type': 'application/json' },
    });
    const createRes = await POST(createReq);
    expect(createRes.status).toBe(200);

    // Read
    const getRes = await GET();
    const body = await getRes.json();
    const skill = body.skills.find((s: { name: string }) => s.name === 'test-crud');
    expect(skill).toBeDefined();
    expect(skill.description).toBe('CRUD test');
  });

  it('prevents duplicate skill creation', async () => {
    const { POST } = await importRoute();

    const makeReq = () => new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: 'dup-skill', description: 'test' }),
      headers: { 'content-type': 'application/json' },
    });

    const first = await POST(makeReq());
    expect(first.status).toBe(200);

    const second = await POST(makeReq());
    expect(second.status).toBe(409);
  });

  it('deletes a user skill', async () => {
    const { POST } = await importRoute();

    // Create first
    const createReq = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: 'to-delete', description: 'bye' }),
      headers: { 'content-type': 'application/json' },
    });
    await POST(createReq);

    // Delete
    const deleteReq = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', name: 'to-delete' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(deleteReq);
    expect(res.status).toBe(200);

    // Verify directory removed
    const skillDir = path.join(tempRoot, '.skills', 'to-delete');
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  it('returns 404 for deleting non-existent skill', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', name: 'no-such-skill' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('toggles skill disabled state', async () => {
    const { POST } = await importRoute();

    // Disable a skill
    const disableReq = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'toggle', name: 'some-skill', enabled: false }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(disableReq);
    expect(res.status).toBe(200);
  });

  it('reads a skill via POST read action', async () => {
    const { POST } = await importRoute();

    // Create first
    await POST(new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: 'read-test', content: '---\nname: read-test\ndescription: hello\n---\n\nbody' }),
      headers: { 'content-type': 'application/json' },
    }));

    // Read via POST
    const readReq = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'read', name: 'read-test' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(readReq);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toContain('read-test');
    expect(body.content).toContain('body');
  });

  it('returns 404 for reading non-existent skill', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'read', name: 'ghost-skill' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('updates a user skill content', async () => {
    const { POST } = await importRoute();

    // Create first
    await POST(new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: 'update-test', description: 'original' }),
      headers: { 'content-type': 'application/json' },
    }));

    // Update content
    const newContent = '---\nname: update-test\ndescription: updated\n---\n\nnew body';
    const updateReq = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'update', name: 'update-test', content: newContent }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(updateReq);
    expect(res.status).toBe(200);

    // Verify by reading back
    const readReq = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'read', name: 'update-test' }),
      headers: { 'content-type': 'application/json' },
    });
    const readRes = await POST(readReq);
    const body = await readRes.json();
    expect(body.content).toContain('updated');
    expect(body.content).toContain('new body');
  });

  it('returns 404 for updating non-existent skill', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'update', name: 'no-such-skill', content: 'x' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('toggle requires name parameter', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'toggle' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('toggle re-enables a previously disabled skill', async () => {
    const { POST } = await importRoute();

    // Disable
    const disRes = await POST(new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'toggle', name: 'toggle-roundtrip', enabled: false }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(disRes.status).toBe(200);

    // Re-enable
    const enRes = await POST(new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'toggle', name: 'toggle-roundtrip', enabled: true }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(enRes.status).toBe(200);

    // Verify settings: the skill should NOT be in the disabled list after re-enable.
    // readSettings reads from os.homedir()/.mindos/config.json (module-level const),
    // so we verify the roundtrip at the API level rather than through GET which
    // depends on MIND_ROOT for scanning skill dirs.
    const { readSettings } = await import('../../lib/settings');
    const settings = readSettings();
    const disabled = settings.disabledSkills ?? [];
    expect(disabled).not.toContain('toggle-roundtrip');
  });

  it('returns 400 for unknown action', async () => {
    const { POST } = await importRoute();
    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({ action: 'fly' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
