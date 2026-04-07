/**
 * Hook for uploading images to the .media/ directory in the editor.
 *
 * Unlike useImageUpload (for chat image attachments), this hook uploads
 * images to the knowledge base's .media/ directory and returns file paths
 * suitable for use in markdown `![alt](path)` syntax.
 *
 * Usage:
 *   const { uploadToMedia, isUploading } = useEditorImageUpload();
 *   const paths = await uploadToMedia([file1, file2]);
 *   // paths = ['/.media/2026-04-07_abc123.png', ...]
 */

import { useState, useCallback } from 'react';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB per image
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

/**
 * Generates a unique filename: YYYY-MM-DD_randomhash.ext
 */
function generateImageFileName(originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase() || 'png';
  const timestamp = new Date().toISOString().split('T')[0];
  const randomHash = Math.random().toString(36).slice(2, 10);
  return `${timestamp}_${randomHash}.${ext}`;
}

/** Converts a File to base64 string (without data URL prefix). */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // Strip "data:image/...;base64," prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useEditorImageUpload() {
  const [isUploading, setIsUploading] = useState(false);

  const uploadToMedia = useCallback(async (files: File[]): Promise<string[]> => {
    setIsUploading(true);

    try {
      // Filter valid images
      const validFiles: Array<{ base64: string; newName: string }> = [];
      const skippedReasons: string[] = [];

      for (const file of files) {
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
          skippedReasons.push(`${file.name}: unsupported format`);
          continue;
        }
        if (file.size > MAX_IMAGE_SIZE) {
          skippedReasons.push(`${file.name}: exceeds 10MB limit`);
          continue;
        }

        const base64 = await fileToBase64(file);
        const newName = generateImageFileName(file.name);
        validFiles.push({ base64, newName });
      }

      if (validFiles.length === 0) {
        throw new Error(skippedReasons.length > 0
          ? skippedReasons.join('; ')
          : 'No valid images to upload');
      }

      const response = await fetch('/api/file/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: validFiles.map((img) => ({
            name: img.newName,
            content: img.base64,
            encoding: 'base64',
          })),
          targetSpace: '.media',
          organize: false,  // Don't trigger AI organize for media files
          conflict: 'rename',
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      return (result.created ?? []).map(
        (item: { path: string }) => `/${item.path}`,
      );
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { uploadToMedia, isUploading };
}
