import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestMindRoot } from '../setup';
import type { UrlCaptureResult } from '@/lib/core/web-clip';

const captureUrlMock = vi.hoisted(() => vi.fn<() => Promise<UrlCaptureResult>>());

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/core/web-clip', async () => {
  const actual = await vi.importActual<typeof import('@/lib/core/web-clip')>('@/lib/core/web-clip');
  return {
    ...actual,
    captureUrl: captureUrlMock,
  };
});

function clipRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/inbox/clip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/inbox/clip', () => {
  beforeEach(() => {
    captureUrlMock.mockReset();
  });

  it('stores an HTTP PDF URL as a PDF file in Inbox', async () => {
    const pdfBytes = Buffer.from('%PDF-1.7\nremote paper');
    captureUrlMock.mockResolvedValue({
      title: 'Remote Paper.pdf',
      fileName: 'Remote Paper.pdf',
      contentBase64: pdfBytes.toString('base64'),
      contentType: 'application/pdf; charset=binary',
      byteLength: pdfBytes.length,
      wordCount: 0,
      url: 'https://papers.example.com/paper?id=42',
      siteName: 'papers.example.com',
      byline: null,
      mode: 'file',
    });

    const { POST } = await import('@/app/api/inbox/clip/route');
    const res = await POST(clipRequest({ url: 'https://papers.example.com/paper?id=42' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      title: 'Remote Paper.pdf',
      fileName: 'Inbox/Remote Paper.pdf',
      mode: 'file',
      url: 'https://papers.example.com/paper?id=42',
      contentType: 'application/pdf; charset=binary',
      byteLength: pdfBytes.length,
    });
    expect(captureUrlMock).toHaveBeenCalledWith('https://papers.example.com/paper?id=42');
    expect(fs.readFileSync(path.join(getTestMindRoot(), 'Inbox', 'Remote Paper.pdf'))).toEqual(pdfBytes);
  });

  it('stores an HTTP image URL as an image file in Inbox', async () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    captureUrlMock.mockResolvedValue({
      title: 'diagram.png',
      fileName: 'diagram.png',
      contentBase64: imageBytes.toString('base64'),
      contentType: 'image/png',
      byteLength: imageBytes.length,
      wordCount: 0,
      url: 'https://assets.example.com/diagram.png',
      siteName: 'assets.example.com',
      byline: null,
      mode: 'file',
    });

    const { POST } = await import('@/app/api/inbox/clip/route');
    const res = await POST(clipRequest({ url: 'https://assets.example.com/diagram.png' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      title: 'diagram.png',
      fileName: 'Inbox/diagram.png',
      mode: 'file',
      url: 'https://assets.example.com/diagram.png',
      contentType: 'image/png',
      byteLength: imageBytes.length,
    });
    expect(captureUrlMock).toHaveBeenCalledWith('https://assets.example.com/diagram.png');
    expect(fs.readFileSync(path.join(getTestMindRoot(), 'Inbox', 'diagram.png'))).toEqual(imageBytes);
  });
});
