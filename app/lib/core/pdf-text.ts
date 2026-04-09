import { execFileSync } from 'child_process';
import { resolveScript } from './resolve-script';

/**
 * Extract text from a PDF file via pdfjs-dist (child process).
 * Spawns extract-pdf.cjs to avoid Turbopack/pdfjs-dist worker conflicts.
 * Returns extracted text, or empty string if extraction fails.
 */
export function extractPdfText(absolutePath: string): string {
  try {
    const scriptPath = resolveScript('extract-pdf.cjs');
    if (!scriptPath) return '';

    const stdout = execFileSync('node', [scriptPath, absolutePath], {
      encoding: 'utf-8',
      timeout: 15_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const result = JSON.parse(stdout) as { text: string; pages: number };
    return result.text || '';
  } catch {
    return '';
  }
}
