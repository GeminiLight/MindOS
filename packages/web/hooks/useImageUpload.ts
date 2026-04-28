'use client';

import { useState, useCallback } from 'react';
import type { ImagePart, ImageMimeType } from '@/lib/types';

const ALLOWED_IMAGE_TYPES: Set<string> = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
]);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB per image
const MAX_IMAGES = 4;
const MAX_DIMENSION = 1920; // Compress to this max width/height

function isImageMimeType(type: string): type is ImageMimeType {
  return ALLOWED_IMAGE_TYPES.has(type);
}

/** Compress image to JPEG if over size/dimension limits */
async function compressImage(file: File): Promise<{ data: string; mimeType: ImageMimeType }> {
  const mimeType = file.type as ImageMimeType;

  // If small enough, use as-is (skip canvas compression to preserve GIF animation)
  if (file.size <= MAX_IMAGE_SIZE) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return { data: btoa(binary), mimeType };
  }

  // Compress via canvas
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(objectUrl); reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = dataUrl.split(',')[1];
      URL.revokeObjectURL(objectUrl);
      resolve({ data: base64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')); };
    img.src = objectUrl;
  });
}

/** Convert clipboard/DataTransfer items to File[] */
function extractImageFiles(items: DataTransferItemList | DataTransferItem[]): File[] {
  const files: File[] = [];
  const list = Array.from(items);
  for (const item of list) {
    if (item.kind === 'file' && ALLOWED_IMAGE_TYPES.has(item.type)) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export function useImageUpload() {
  const [images, setImages] = useState<ImagePart[]>([]);
  const [imageError, setImageError] = useState('');

  const addImages = useCallback(async (files: File[]) => {
    setImageError('');
    const toProcess = files.slice(0, MAX_IMAGES);

    const results: ImagePart[] = [];
    for (const file of toProcess) {
      if (!isImageMimeType(file.type)) {
        setImageError(`Unsupported image type: ${file.type}`);
        continue;
      }
      try {
        const { data, mimeType } = await compressImage(file);
        results.push({ type: 'image', data, mimeType, fileName: file.name || undefined });
      } catch {
        setImageError(`Failed to process image: ${file.name}`);
      }
    }

    setImages(prev => {
      const merged = [...prev, ...results];
      if (merged.length > MAX_IMAGES) {
        setImageError(`Maximum ${MAX_IMAGES} images allowed`);
        return merged.slice(0, MAX_IMAGES);
      }
      return merged;
    });
  }, []);

  /** Handle paste event — returns true if images were found */
  const handlePaste = useCallback(async (e: ClipboardEvent | React.ClipboardEvent): Promise<boolean> => {
    const items = e.clipboardData?.items;
    if (!items) return false;
    const files = extractImageFiles(items);
    if (files.length === 0) return false;
    await addImages(files);
    return true;
  }, [addImages]);

  /** Handle drop event */
  const handleDrop = useCallback(async (e: DragEvent | React.DragEvent) => {
    const items = e.dataTransfer?.items;
    if (!items) return;
    const files = extractImageFiles(items);
    if (files.length > 0) {
      e.preventDefault();
      await addImages(files);
    }
  }, [addImages]);

  /** Handle file input change */
  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter(f => isImageMimeType(f.type));
    await addImages(imageFiles);
  }, [addImages]);

  const removeImage = useCallback((idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const clearImages = useCallback(() => {
    setImages([]);
    setImageError('');
  }, []);

  return {
    images,
    imageError,
    addImages,
    handlePaste,
    handleDrop,
    handleFileSelect,
    removeImage,
    clearImages,
  };
}
