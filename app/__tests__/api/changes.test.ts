import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as FilePOST } from '../../app/api/file/route';
import { GET, POST } from '../../app/api/changes/route';
import { invalidateCache } from '../../lib/fs';

describe('GET/POST /api/changes', () => {
  function postJson(url: string, body: Record<string, unknown>) {
    return new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('summary returns unreadCount after file mutation', async () => {
    invalidateCache();
    await FilePOST(postJson('http://localhost/api/file', {
      op: 'save_file',
      path: 'changes-api.md',
      content: 'hello',
    }));

    const res = await GET(new NextRequest('http://localhost/api/changes?op=summary'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.unreadCount).toBe('number');
    expect(body.unreadCount).toBeGreaterThan(0);
  });

  it('list returns events and supports path filter', async () => {
    await FilePOST(postJson('http://localhost/api/file', {
      op: 'save_file',
      path: 'filter-a.md',
      content: 'A1',
    }));
    await FilePOST(postJson('http://localhost/api/file', {
      op: 'save_file',
      path: 'filter-b.md',
      content: 'B1',
    }));

    const all = await GET(new NextRequest('http://localhost/api/changes?op=list&limit=20'));
    expect(all.status).toBe(200);
    const allBody = await all.json();
    expect(Array.isArray(allBody.events)).toBe(true);
    expect(allBody.events.length).toBeGreaterThanOrEqual(2);

    const filtered = await GET(new NextRequest('http://localhost/api/changes?op=list&path=filter-a.md&limit=20'));
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json();
    expect(filteredBody.events.every((e: { path: string }) => e.path === 'filter-a.md')).toBe(true);
  });

  it('list supports source, operation and keyword filters', async () => {
    await FilePOST(postJson('http://localhost/api/file', {
      op: 'save_file',
      path: 'agent-filter.md',
      content: 'A',
      source: 'agent',
    }));
    await FilePOST(postJson('http://localhost/api/file', {
      op: 'save_file',
      path: 'user-filter.md',
      content: 'B',
      source: 'user',
    }));

    const sourceFiltered = await GET(new NextRequest('http://localhost/api/changes?op=list&source=agent&limit=50'));
    const sourceBody = await sourceFiltered.json();
    expect(sourceBody.events.every((e: { source: string }) => e.source === 'agent')).toBe(true);

    const opFiltered = await GET(new NextRequest('http://localhost/api/changes?op=list&event_op=save_file&limit=50'));
    const opBody = await opFiltered.json();
    expect(opBody.events.every((e: { op: string }) => e.op === 'save_file')).toBe(true);

    const queryFiltered = await GET(new NextRequest('http://localhost/api/changes?op=list&q=agent-filter.md&limit=50'));
    const queryBody = await queryFiltered.json();
    expect(queryBody.events.some((e: { path: string }) => e.path === 'agent-filter.md')).toBe(true);
  });

  it('mark_seen clears unread count', async () => {
    await FilePOST(postJson('http://localhost/api/file', {
      op: 'save_file',
      path: 'mark-seen.md',
      content: 'C1',
    }));

    const marked = await POST(postJson('http://localhost/api/changes', { op: 'mark_seen' }));
    expect(marked.status).toBe(200);

    const summary = await GET(new NextRequest('http://localhost/api/changes?op=summary'));
    const body = await summary.json();
    expect(body.unreadCount).toBe(0);
  });
});
