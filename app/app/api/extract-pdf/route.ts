import { NextRequest, NextResponse } from 'next/server';

const MAX_TEXT_CHARS = 30_000;
const MAX_PAGES = 20;
const MAX_BYTES = 12 * 1024 * 1024; // 12MB

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n[...truncated from PDF]`;
}

export async function POST(req: NextRequest) {
  let body: { name?: string; dataBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = body.name ?? 'uploaded.pdf';
  const dataBase64 = body.dataBase64;
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return NextResponse.json({ error: 'dataBase64 is required' }, { status: 400 });
  }

  try {
    const raw = Buffer.from(dataBase64, 'base64');
    if (raw.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'PDF is too large (max 12MB)' }, { status: 400 });
    }

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(raw),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: unknown) => {
          if (item && typeof item === 'object' && 'str' in item) {
            return String((item as { str: unknown }).str ?? '');
          }
          return '';
        })
        .filter(Boolean)
        .join(' ')
        .trim();

      if (pageText) pages.push(`[Page ${i}]\n${pageText}`);
    }

    const text = pages.join('\n\n');
    return NextResponse.json({
      name,
      text: truncateText(text),
      extracted: text.length > 0,
      pagesParsed: pageCount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to extract PDF text' },
      { status: 500 },
    );
  }
}
