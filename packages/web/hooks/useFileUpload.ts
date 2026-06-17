'use client';

import { useState, useCallback, useLayoutEffect, useRef } from 'react';
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

type FilePayload = {
  dataBase64: string;
  mimeType: string;
  size: number;
  buffer: ArrayBuffer;
};

async function readFilePayload(file: File): Promise<FilePayload> {
  const buffer = await file.arrayBuffer();
  return {
    dataBase64: uint8ToBase64(new Uint8Array(buffer)),
    mimeType: file.type || mimeTypeForExtension(getExt(file.name)),
    size: file.size,
    buffer,
  };
}

function mimeTypeForExtension(ext: string): string {
  switch (ext) {
    case '.txt': return 'text/plain';
    case '.md':
    case '.markdown': return 'text/markdown';
    case '.csv': return 'text/csv';
    case '.json': return 'application/json';
    case '.yaml':
    case '.yml': return 'application/yaml';
    case '.xml': return 'application/xml';
    case '.html':
    case '.htm': return 'text/html';
    case '.pdf': return 'application/pdf';
    case '.doc': return 'application/msword';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.docm': return 'application/vnd.ms-word.document.macroEnabled.12';
    default: return 'application/octet-stream';
  }
}

async function extractPdfToAttachment(file: File): Promise<LocalAttachment> {
  const name = file.name;
  let payload: FilePayload | undefined;

  try {
    payload = await readFilePayload(file);

    const res = await fetch('/api/extract-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataBase64: payload.dataBase64 }),
    });

    let extractPayload: {
      text?: string;
      extracted?: 'success' | 'empty' | 'error';
      extractionError?: string;
      error?: string;
      truncated?: boolean;
      totalChars?: number;
      pagesParsed?: number;
    } = {};
    try {
      extractPayload = await res.json();
    } catch {
      throw new Error('Failed to parse extraction response');
    }

    if (!res.ok) {
      throw new Error(extractPayload.error || `PDF extraction failed (${res.status})`);
    }

    // Handle extraction error state
    if (extractPayload.extracted === 'error') {
      return {
        name,
        content: `[PDF: ${name}] Failed to extract text from this PDF.`,
        mimeType: payload.mimeType,
        size: payload.size,
        dataBase64: payload.dataBase64,
        status: 'error',
        error: extractPayload.extractionError || 'PDF extraction failed (unable to parse PDF)',
      };
    }

    // Handle empty PDF (no extraction error, but no text)
    const text = extractPayload.extracted === 'success' ? (extractPayload.text || '') : '';
    if (!text) {
      return {
        name,
        content: `[PDF: ${name}] Could not extract readable text (possibly scanned/image PDF).`,
        mimeType: payload.mimeType,
        size: payload.size,
        dataBase64: payload.dataBase64,
        status: 'error',
        error: 'No extractable text found — PDF may be scanned, image-only, or have no text content',
      };
    }

    const att: LocalAttachment = {
      name,
      content: `[PDF TEXT EXTRACTED: ${name}]\n\n${text}`,
      mimeType: payload.mimeType,
      size: payload.size,
      dataBase64: payload.dataBase64,
      status: 'success',
    };

    if (extractPayload.truncated && extractPayload.totalChars) {
      att.truncatedInfo = {
        totalChars: extractPayload.totalChars,
        includedChars: text.length,
        totalPages: extractPayload.pagesParsed ?? 0,
      };
    }

    return att;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      name,
      content: `[PDF: ${name}] Failed to extract text from this PDF.`,
      ...(payload ? { mimeType: payload.mimeType, size: payload.size, dataBase64: payload.dataBase64 } : {
        mimeType: file.type || mimeTypeForExtension(getExt(file.name)),
        size: file.size,
      }),
      status: 'error',
      error: msg,
    };
  }
}

async function extractDocxToAttachment(file: File): Promise<LocalAttachment> {
  const name = file.name;
  let payload: FilePayload | undefined;

  try {
    payload = await readFilePayload(file);

    const res = await fetch('/api/extract-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataBase64: payload.dataBase64 }),
    });

    let extractPayload: {
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
      extractPayload = await res.json();
    } catch {
      throw new Error('Failed to parse extraction response');
    }

    if (!res.ok) {
      throw new Error(extractPayload.error || `Word extraction failed (${res.status})`);
    }

    // Handle extraction error state
    if (!extractPayload.extracted) {
      return {
        name,
        content: `[Word: ${name}] Failed to extract text from this Word document.`,
        mimeType: payload.mimeType,
        size: payload.size,
        dataBase64: payload.dataBase64,
        status: 'error',
        error: extractPayload.errorMessage || 'Word extraction failed',
      };
    }

    // Handle empty document
    const text = extractPayload.text || '';
    if (!text) {
      return {
        name,
        content: `[Word: ${name}] Could not extract readable text (empty document).`,
        mimeType: payload.mimeType,
        size: payload.size,
        dataBase64: payload.dataBase64,
        status: 'error',
        error: 'No extractable text found — document may be empty or corrupted',
      };
    }

    const att: LocalAttachment = {
      name,
      content: `[WORD TEXT EXTRACTED: ${name}]\n\n${text}`,
      mimeType: payload.mimeType,
      size: payload.size,
      dataBase64: payload.dataBase64,
      status: 'success',
    };

    if (extractPayload.truncated && extractPayload.chars) {
      const truncInfo = {
        totalChars: extractPayload.chars || 0,
        includedChars: extractPayload.charsTruncated || text.length,
        totalPages: extractPayload.pages ?? 0,
      };

      att.truncatedInfo = truncInfo;
    }

    if (extractPayload.warning) {
      if (!att.truncatedInfo) {
        att.truncatedInfo = {
          totalChars: extractPayload.chars || text.length,
          includedChars: text.length,
          totalPages: extractPayload.pages ?? 0,
        };
      }
      att.truncatedInfo.warning = extractPayload.warning;
    }

    return att;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      name,
      content: `[Word: ${name}] Failed to extract text from this Word document.`,
      ...(payload ? { mimeType: payload.mimeType, size: payload.size, dataBase64: payload.dataBase64 } : {
        mimeType: file.type || mimeTypeForExtension(getExt(file.name)),
        size: file.size,
      }),
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
  useLayoutEffect(() => {
    labelsRef.current = labels;
  }, [labels]);

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
        immediateItems.push({ name: f.name, content: '', mimeType: f.type || mimeTypeForExtension(ext), size: f.size, status: 'loading' });
        pdfFiles.push(f);
      } else if (ext === '.doc' || ext === '.docx' || ext === '.docm') {
        immediateItems.push({ name: f.name, content: '', mimeType: f.type || mimeTypeForExtension(ext), size: f.size, status: 'loading' });
        docxFiles.push(f);
      } else {
        const payload = await readFilePayload(f);
        immediateItems.push({
          name: f.name,
          content: new TextDecoder().decode(payload.buffer),
          mimeType: payload.mimeType,
          size: payload.size,
          dataBase64: payload.dataBase64,
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
