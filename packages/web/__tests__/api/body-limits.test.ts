import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { EXTRACT_DOCX_MAX_BODY_BYTES, EXTRACT_PDF_MAX_BODY_BYTES } from '@geminilight/mindos/server';
import { KNOWLEDGE_WRITE_MAX_BODY_BYTES } from '@/lib/api/request-utils';
import { POST as inboxPost, DELETE as inboxDelete } from '@/app/api/inbox/route';
import { POST as filePost } from '@/app/api/file/route';
import { POST as importPost } from '@/app/api/file/import/route';
import { POST as extractPdfPost } from '@/app/api/extract-pdf/route';
import { POST as extractDocxPost } from '@/app/api/extract-docx/route';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

function oversized(url: string, limit: number, method = 'POST') {
  return new NextRequest(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'content-length': String(limit + 1),
    },
    body: '{"files":[]}',
  });
}

describe('JSON body limits on write routes', () => {
  it('rejects oversized /api/inbox bodies with 413', async () => {
    const res = await inboxPost(oversized('http://localhost/api/inbox', KNOWLEDGE_WRITE_MAX_BODY_BYTES));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/i);

    const del = await inboxDelete(oversized('http://localhost/api/inbox', KNOWLEDGE_WRITE_MAX_BODY_BYTES, 'DELETE'));
    expect(del.status).toBe(413);
  });

  it('rejects oversized /api/file bodies with 413 while small bodies still reach the handler', async () => {
    const res = await filePost(oversized('http://localhost/api/file', KNOWLEDGE_WRITE_MAX_BODY_BYTES));
    expect(res.status).toBe(413);

    const ok = await filePost(new NextRequest('http://localhost/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'save_file', path: 'limits.md', content: 'fits' }),
    }));
    expect(ok.status).toBe(200);
  });

  it('rejects oversized /api/file/import bodies with 413', async () => {
    const res = await importPost(oversized('http://localhost/api/file/import', KNOWLEDGE_WRITE_MAX_BODY_BYTES));
    expect(res.status).toBe(413);
  });

  it('uses the product extract limits for /api/extract-pdf and /api/extract-docx', async () => {
    const pdf = await extractPdfPost(oversized('http://localhost/api/extract-pdf', EXTRACT_PDF_MAX_BODY_BYTES));
    expect(pdf.status).toBe(413);

    const docx = await extractDocxPost(oversized('http://localhost/api/extract-docx', EXTRACT_DOCX_MAX_BODY_BYTES));
    expect(docx.status).toBe(413);
  });

  it('keeps invalid JSON as a 400 on the write routes', async () => {
    const res = await filePost(new NextRequest('http://localhost/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    }));
    expect(res.status).toBe(400);
    // The shared body reader owns the message for every host.
    expect((await res.json()).error).toBe('Invalid JSON body');
  });
});
