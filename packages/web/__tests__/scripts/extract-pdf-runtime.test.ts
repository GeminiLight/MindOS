import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Runtime integration test for extract-pdf.cjs.
 *
 * Unlike the API tests which run POST /api/extract-pdf via vitest imports,
 * this test spawns the actual child process (as happens in production) to
 * verify that pdfjs-dist can be resolved when running extract-pdf.cjs outside
 * the Next.js bundler context.
 *
 * This catches the real failure mode: "Cannot find module 'pdfjs-dist/legacy/build/pdf.mjs'"
 * which only occurs when pdfjs-dist is missing from the runtime's node_modules.
 */

// Minimal valid PDF with extractable text
const MINIMAL_PDF = Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj

4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000360 00000 n 

trailer
<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF`);

describe('extract-pdf.cjs runtime integration', () => {
  const scriptPath = path.resolve(__dirname, '../../scripts/extract-pdf.cjs');

  it('script file exists', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('successfully loads pdfjs-dist and extracts text', () => {
    // Write test PDF to temp file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-'));
    const pdfPath = path.join(tmpDir, 'test.pdf');
    fs.writeFileSync(pdfPath, MINIMAL_PDF);

    try {
      // Spawn the script exactly as the API route does
      const result = execFileSync('node', [scriptPath, pdfPath], {
        encoding: 'utf-8',
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse JSON output
      const parsed = JSON.parse(result.trim()) as {
        text: string;
        pages: number;
        error?: string;
      };

      // Must not have an error
      expect(parsed.error).toBeUndefined();

      // Must extract the expected text
      expect(parsed.text).toContain('Hello');
      expect(parsed.pages).toBe(1);
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns error JSON for invalid PDF (not crash)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-'));
    const pdfPath = path.join(tmpDir, 'invalid.pdf');
    fs.writeFileSync(pdfPath, 'not a valid PDF');

    try {
      const result = execFileSync('node', [scriptPath, pdfPath], {
        encoding: 'utf-8',
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const parsed = JSON.parse(result.trim()) as {
        text: string;
        pages: number;
        error?: string;
      };

      // Should have an error field, not throw
      expect(parsed.error).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns error JSON for missing file', () => {
    const result = execFileSync('node', [scriptPath, '/nonexistent/path.pdf'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    const parsed = JSON.parse(result.trim()) as {
      text: string;
      pages: number;
      error?: string;
    };

    expect(parsed.error).toContain('not found');
  });
});
