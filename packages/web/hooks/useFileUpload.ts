'use client';

import { useState, useCallback, useRef } from 'react';
import type { LocalAttachment } from '@/lib/types';

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.pdf',
  '.doc', '.docx', '.docm',
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

async function extractPdfToAttachment(file: File): Promise<LocalAttachment> {
  const name = file.name;

  try {
    const buffer = await file.arrayBuffer();
    const dataBase64 = uint8ToBase64(new Uint8Array(buffer));

    const res = await fetch('/api/extract-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataBase64 }),
    });

    let payload: {
      text?: string;
      extracted?: 'success' | 'empty' | 'error';
      extractionError?: string;
      error?: string;
      truncated?: boolean;
      totalChars?: number;
      pagesParsed?: number;
    } = {};
    try {
      payload = await res.json();
    } catch {
      throw new Error('Failed to parse extraction response');
    }

    if (!res.ok) {
      throw new Error(payload.error || `PDF extraction failed (${res.status})`);
    }

    // Handle extraction error state
    if (payload.extracted === 'error') {
      return {
        name,
        content: `[PDF: ${name}] Failed to extract text from this PDF.`,
        status: 'error',
        error: payload.extractionError || 'PDF extraction failed (unable to parse PDF)',
      };
    }

    // Handle empty PDF (no extraction error, but no text)
    const text = payload.extracted === 'success' ? (payload.text || '') : '';
    if (!text) {
      return {
        name,
        content: `[PDF: ${name}] Could not extract readable text (possibly scanned/image PDF).`,
        status: 'error',
        error: 'No extractable text found — PDF may be scanned, image-only, or have no text content',
      };
    }

    const att: LocalAttachment = {
      name,
      content: `[PDF TEXT EXTRACTED: ${name}]\n\n${text}`,
      status: 'success',
    };

    if (payload.truncated && payload.totalChars) {
      att.truncatedInfo = {
        totalChars: payload.totalChars,
        includedChars: text.length,
        totalPages: payload.pagesParsed ?? 0,
      };
    }

    return att;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      name,
      content: `[PDF: ${name}] Failed to extract text from this PDF.`,
      status: 'error',
      error: msg,
    };
  }
}

async function extractDocxToAttachment(file: File): Promise<LocalAttachment> {
  const name = file.name;

  try {
    const buffer = await file.arrayBuffer();
    const dataBase64 = uint8ToBase64(new Uint8Array(buffer));

    const res = await fetch('/api/extract-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataBase64 }),
    });

    let payload: {
      text?: string;
      markdown?: string;
      extracted?: boolean;
      extractionError?: string;
      errorMessage?: string;
      error?: string;
      truncated?: boolean;
      chars?: number;
      charsTruncated?: number;
      pages?: number;
      imageCount?: number;
      warning?: string;
    } = {};
    try {
      payload = await res.json();
    } catch {
      throw new Error('Failed to parse extraction response');
    }

    if (!res.ok) {
      throw new Error(payload.error || `Word extraction failed (${res.status})`);
    }

    // Handle extraction error state
    if (!payload.extracted) {
      return {
        name,
        content: `[Word: ${name}] Failed to extract text from this Word document.`,
        status: 'error',
        error: payload.errorMessage || 'Word extraction failed',
      };
    }

    // Handle empty document
    const text = payload.text || '';
    if (!text) {
      return {
        name,
        content: `[Word: ${name}] Could not extract readable text (empty document).`,
        status: 'error',
        error: 'No extractable text found — document may be empty or corrupted',
      };
    }

    const att: LocalAttachment = {
      name,
      content: `[WORD TEXT EXTRACTED: ${name}]\n\n${text}`,
      status: 'success',
    };

    if (payload.truncated && payload.chars) {
      const truncInfo = {
        totalChars: payload.chars || 0,
        includedChars: payload.charsTruncated || text.length,
        totalPages: payload.pages ?? 0,
      };

      att.truncatedInfo = truncInfo;
    }

    if (payload.warning) {
      if (!att.truncatedInfo) {
        att.truncatedInfo = {
          totalChars: payload.chars || text.length,
          includedChars: text.length,
          totalPages: payload.pages ?? 0,
        };
      }
      att.truncatedInfo.warning = payload.warning;
    }

    return att;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      name,
      content: `[Word: ${name}] Failed to extract text from this Word document.`,
      status: 'error',
      error: msg,
    };
  }
}

export interface FileUploadLabels {
  unsupportedType?: string;
}

export function useFileUpload(labels?: FileUploadLabels) {
  const [localAttachments, setLocalAttachments] = useState<LocalAttachment[]>([]);
  const [uploadError, setUploadError] = useState('');
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const labelsRef = useRef(labels);
  labelsRef.current = labels;

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
      const label = labelsRef.current?.unsupportedType ?? 'Unsupported file type';
      setUploadError(`${label}: ${rejected.join(', ')}`);
    } else {
      setUploadError('');
    }

    // Phase 1: Immediately add all files — PDFs and Word files start in 'loading' state
    const pdfFiles: File[] = [];
    const docxFiles: File[] = [];
    const immediateItems: LocalAttachment[] = [];

    for (const f of accepted) {
      const ext = getExt(f.name);
      if (ext === '.pdf') {
        immediateItems.push({ name: f.name, content: '', status: 'loading' });
        pdfFiles.push(f);
      } else if (ext === '.doc' || ext === '.docx' || ext === '.docm') {
        immediateItems.push({ name: f.name, content: '', status: 'loading' });
        docxFiles.push(f);
      } else {
        immediateItems.push({
          name: f.name,
          content: await f.text(),
          status: 'success',
        });
      }
    }

    setLocalAttachments((prev) => {
      const merged = [...prev];
      for (const item of immediateItems) {
        if (!merged.some((m) => m.name === item.name)) merged.push(item);
      }
      return merged;
    });

    // Phase 2: Extract PDFs and Word files in parallel, then update each one in-place
    const extractionPromises: Promise<void>[] = [];

    if (pdfFiles.length > 0) {
      extractionPromises.push(
        Promise.all(pdfFiles.map(extractPdfToAttachment)).then((results) => {
          setLocalAttachments((prev) =>
            prev.map((att) => {
              if (att.status !== 'loading') return att;
              const result = results.find((r) => r.name === att.name);
              return result ?? att;
            }),
          );
        }),
      );
    }

    if (docxFiles.length > 0) {
      extractionPromises.push(
        Promise.all(docxFiles.map(extractDocxToAttachment)).then((results) => {
          setLocalAttachments((prev) =>
            prev.map((att) => {
              if (att.status !== 'loading') return att;
              const result = results.find((r) => r.name === att.name);
              return result ?? att;
            }),
          );
        }),
      );
    }

    await Promise.all(extractionPromises);
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
