'use client';

import { useState, useCallback, useRef } from 'react';
import { ALLOWED_IMPORT_EXTENSIONS } from '@/lib/core/file-convert';

export type ImportIntent = 'archive' | 'digest';
export type ImportStep = 'select' | 'archive_config' | 'importing' | 'done' | 'organizing' | 'organize_review';
export type ConflictMode = 'skip' | 'rename' | 'overwrite';

export interface ImportFile {
  file: File;
  name: string;
  size: number;
  content: string | null;
  loading: boolean;
  error: string | null;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_PDF_SIZE = 12 * 1024 * 1024;
const MAX_FILES = 20;

function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIdx = dataUrl.indexOf(',');
      resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  if (!base64) throw new Error('Empty PDF file');

  const res = await fetch('/api/extract-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, dataBase64: base64 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'PDF extraction failed');
  }
  const data = await res.json() as { text?: string; extracted?: boolean };
  if (!data.extracted || !data.text) throw new Error('No text extracted from PDF');
  return data.text;
}

export function useFileImport() {
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [step, setStep] = useState<ImportStep>('select');
  const [intent, setIntent] = useState<ImportIntent>('archive');
  const [targetSpace, setTargetSpace] = useState('');
  const [conflict, setConflict] = useState<ConflictMode>('rename');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    created: Array<{ original: string; path: string }>;
    skipped: Array<{ name: string; reason: string }>;
    errors: Array<{ name: string; error: string }>;
    updatedFiles: string[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).slice(0, MAX_FILES);
    const newFiles: ImportFile[] = [];

    for (const file of incoming) {
      const ext = getExt(file.name);
      const maxSize = ext === '.pdf' ? MAX_PDF_SIZE : MAX_FILE_SIZE;

      let error: string | null = null;
      if (!ALLOWED_IMPORT_EXTENSIONS.has(ext)) {
        error = 'unsupported';
      } else if (file.size > maxSize) {
        error = 'tooLarge';
      }

      newFiles.push({
        file,
        name: file.name,
        size: file.size,
        content: null,
        loading: !error,
        error,
      });
    }

    setFiles(prev => {
      const merged = [...prev];
      for (const f of newFiles) {
        const isDup = merged.some(m =>
          m.name === f.name && m.size === f.size && m.file.lastModified === f.file.lastModified
        );
        if (!isDup && merged.length < MAX_FILES) merged.push(f);
      }
      return merged;
    });

    for (const f of newFiles) {
      if (f.error) continue;
      try {
        const ext = getExt(f.name);
        let text: string;
        if (ext === '.pdf') {
          text = await extractPdfText(f.file);
        } else {
          text = await f.file.text();
        }
        setFiles(prev => prev.map(p =>
          p.name === f.name && p.size === f.size
            ? { ...p, content: text, loading: false }
            : p
        ));
      } catch {
        setFiles(prev => prev.map(p =>
          p.name === f.name && p.size === f.size
            ? { ...p, loading: false, error: 'readFailed' }
            : p
        ));
      }
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setStep('select');
    setResult(null);
  }, []);

  const validFiles = files.filter(f => !f.error && f.content !== null);
  const allReady = files.length > 0 && files.every(f => !f.loading);
  const hasErrors = files.some(f => f.error);

  const doArchive = useCallback(async () => {
    if (validFiles.length === 0) return;
    setImporting(true);
    setStep('importing');

    try {
      const payload = {
        files: validFiles.map(f => ({
          name: f.name,
          content: f.content!,
        })),
        targetSpace: targetSpace || undefined,
        conflict,
        organize: true,
      };

      const res = await fetch('/api/file/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setResult(data);
      setStep('done');
    } catch (err) {
      setResult({
        created: [],
        skipped: [],
        errors: [{ name: '*', error: (err as Error).message }],
        updatedFiles: [],
      });
      setStep('done');
    } finally {
      setImporting(false);
    }
  }, [validFiles, targetSpace, conflict]);

  const reset = useCallback(() => {
    setFiles([]);
    setStep('select');
    setIntent('archive');
    setTargetSpace('');
    setConflict('rename');
    setImporting(false);
    setResult(null);
  }, []);

  return {
    files,
    step,
    intent,
    targetSpace,
    conflict,
    importing,
    result,
    inputRef,
    validFiles,
    allReady,
    hasErrors,
    addFiles,
    removeFile,
    clearFiles,
    setStep,
    setIntent,
    setTargetSpace,
    setConflict,
    doArchive,
    reset,
    formatSize,
  };
}
