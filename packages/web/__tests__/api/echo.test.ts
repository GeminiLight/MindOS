import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET, POST } from '../../app/api/echo/route';
import { getTestMindRoot } from '../setup';

describe('/api/echo', () => {
  function post(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('saves confirmed Echo assistant output as Markdown and updates Echo runtime state', async () => {
    const res = await POST(post({
      op: 'save',
      segment: 'growth',
      assistantId: 'echo-insight',
      markdown: '# 保留 Why & How\n\n## 洞察\n\n每次修复后保留判断过程。',
    }));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.item).toMatchObject({
      type: 'echo.insight',
      segment: 'growth',
      title: '保留 Why & How',
      assistantId: 'echo-insight',
    });
    expect(body.item.path).toMatch(/^Echo\/Insights\/保留-why-how\.md$/);

    const root = getTestMindRoot();
    const saved = fs.readFileSync(path.join(root, body.item.path), 'utf-8');
    expect(saved).toContain('type: echo.insight');
    expect(saved).toContain('title: "保留 Why & How"');
    expect(saved).toContain('assistantId: "echo-insight"');
    expect(saved).toContain('# 保留 Why & How');
    expect(fs.existsSync(path.join(root, 'Echo', 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Echo', 'INSTRUCTION.md'))).toBe(true);

    const index = JSON.parse(fs.readFileSync(path.join(root, '.mindos', 'echo', 'index.json'), 'utf-8')) as { items: Array<{ path: string }> };
    expect(index.items.some((item) => item.path === body.item.path)).toBe(true);

    const eventDir = path.join(root, '.mindos', 'echo', 'events');
    const eventFiles = fs.readdirSync(eventDir);
    expect(eventFiles.some((file) => file.endsWith('.jsonl'))).toBe(true);
    const eventText = fs.readFileSync(path.join(eventDir, eventFiles[0]), 'utf-8');
    expect(eventText).toContain('echo.insight.saved');

    const changeLog = fs.readFileSync(path.join(root, '.mindos', 'change-log.json'), 'utf-8');
    expect(changeLog).toContain(body.item.path);
  });

  it('persists generated drafts without creating visible Echo Markdown', async () => {
    const res = await POST(post({
      op: 'draft',
      segment: 'threads',
      assistantId: 'echo-threader',
      markdown: '# 反复出现的问题\n\n## 现象\n\n同类问题重复出现。',
    }));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.draft).toMatchObject({
      type: 'echo.thread',
      segment: 'threads',
      status: 'draft',
      assistantId: 'echo-threader',
    });

    const root = getTestMindRoot();
    const draft = JSON.parse(fs.readFileSync(path.join(root, '.mindos', 'echo', 'drafts', 'latest-thread.json'), 'utf-8'));
    expect(draft.markdown).toContain('# 反复出现的问题');
    expect(fs.existsSync(path.join(root, 'Echo', 'Threads'))).toBe(false);
  });

  it('lists saved Echo items from Markdown source of truth', async () => {
    await POST(post({
      op: 'save',
      segment: 'practice',
      assistantId: 'echo-promotion',
      markdown: '# 每次修复后复盘\n\n## 行动\n\n记录根因和验证。',
    }));

    const res = await GET(new NextRequest('http://localhost/api/echo?segment=practice'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      type: 'echo.practice',
      segment: 'practice',
      title: '每次修复后复盘',
      excerpt: expect.stringContaining('每次修复后复盘'),
    });
  });

  it('returns a selected Echo item detail for in-page rendering', async () => {
    const saveRes = await POST(post({
      op: 'save',
      segment: 'threads',
      assistantId: 'echo-threader',
      markdown: '# 合并前的脉络\n\n## Why\n\n先看语义 diff，再决定是否发布。',
    }));
    const saveBody = await saveRes.json();

    const res = await GET(new NextRequest(`http://localhost/api/echo?segment=threads&path=${encodeURIComponent(saveBody.item.path)}`));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.item).toMatchObject({
      type: 'echo.thread',
      segment: 'threads',
      title: '合并前的脉络',
      path: saveBody.item.path,
      excerpt: expect.stringContaining('先看语义 diff'),
      markdown: expect.stringContaining('## Why'),
    });
  });

  it('does not allow Echo detail reads outside the requested segment', async () => {
    const saveRes = await POST(post({
      op: 'save',
      segment: 'growth',
      assistantId: 'echo-insight',
      markdown: '# 洞察文件\n\n只属于洞察。',
    }));
    const saveBody = await saveRes.json();

    const res = await GET(new NextRequest(`http://localhost/api/echo?segment=practice&path=${encodeURIComponent(saveBody.item.path)}`));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe('Echo item not found');
  });
});
