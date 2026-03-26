'use client';

import { useState, useCallback, useRef } from 'react';
import type { LocalAttachment } from '@/lib/types';

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.pdf',
]);

function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const dataBase64 = uint8ToBase64(new Uint8Array(buffer));

  const res = await fetch('/api/extract-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, dataBase64 }),
  });

  let payload: { text?: string; extracted?: boolean; error?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // ignore JSON parse error
  }

  if (!res.ok) {
    throw new Error(payload.error || `PDF extraction failed (${res.status})`);
  }

  return payload.extracted ? (payload.text || '') : '';
}

export function useFileUpload() {
  const [localAttachments, setLocalAttachments] = useState<LocalAttachment[]>([]);
  const [uploadError, setUploadError] = useState('');
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const pickFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const picked = Array.from(files).slice(0, 8);
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const f of picked) {
      const ext = getExt(f.name);
      if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
        rejected.push(f.name);
      } else {
        accepted.push(f);
      }
    }

    if (rejected.length > 0) {
      setUploadError(`Unsupported file type: ${rejected.join(', ')}`);
    } else {
      setUploadError('');
    }

    const loaded = await Promise.all(
      accepted.map(async (f) => {
        const ext = getExt(f.name);
        if (ext === '.pdf') {
          try {
            const extracted = await extractPdfText(f);
            return {
              name: f.name,
              content: extracted
                ? `[PDF TEXT EXTRACTED: ${f.name}]\n\n${extracted}`
                : `[PDF: ${f.name}] Could not extract readable text (possibly scanned/image PDF).`,
            };
          } catch {
            return {
              name: f.name,
              content: `[PDF: ${f.name}] Failed to extract text from this PDF.`,
            };
          }
        }
        return { name: f.name, content: await f.text() };
      }),
    );

    setLocalAttachments((prev) => {
      const merged = [...prev];
      for (const item of loaded) {
        if (!merged.some((m) => m.name === item.name && m.content === item.content))
          merged.push(item);
      }
      return merged;
    });
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setLocalAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearAttachments = useCallback(() => {
    setLocalAttachments([]);
    setUploadError('');
  }, []);

  const injectFiles = useCallback((files: LocalAttachment[]) => {
    setLocalAttachments(prev => {
      const merged = [...prev];
      for (const item of files) {
        if (!merged.some(m => m.name === item.name)) merged.push(item);
      }
      return merged;
    });
  }, []);

  return {
    localAttachments,
    uploadError,
    uploadInputRef,
    pickFiles,
    removeAttachment,
    clearAttachments,
    injectFiles,
  };
}
