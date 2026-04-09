'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { FileNode } from '@/lib/types';
import { quickDropToDirectory } from '@/lib/inbox-upload';

/**
 * Encapsulates drag-and-drop logic for directory nodes in the file tree.
 * Handles highlight, auto-expand on hover, and file drop.
 */
export function useDirectoryDragDrop(
  node: FileNode,
  open: boolean,
  setOpen: (v: boolean) => void,
  t: Record<string, unknown>,
) {
  const [isDragTarget, setIsDragTarget] = useState(false);
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoExpand = useCallback(() => {
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
  }, []);

  const handleRowDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dragLeaveTimerRef.current) {
      clearTimeout(dragLeaveTimerRef.current);
      dragLeaveTimerRef.current = null;
    }
    if (!isDragTarget) setIsDragTarget(true);
  }, [isDragTarget]);

  const handleRowDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragTarget(true);
    clearAutoExpand();
    if (!open) {
      autoExpandTimerRef.current = setTimeout(() => {
        setOpen(true);
        autoExpandTimerRef.current = null;
      }, 500);
    }
  }, [open, clearAutoExpand, setOpen]);

  const handleRowDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.stopPropagation();
    dragLeaveTimerRef.current = setTimeout(() => {
      setIsDragTarget(false);
      clearAutoExpand();
      dragLeaveTimerRef.current = null;
    }, 50);
  }, [clearAutoExpand]);

  const handleRowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragTarget(false);
    clearAutoExpand();
    if (dragLeaveTimerRef.current) {
      clearTimeout(dragLeaveTimerRef.current);
      dragLeaveTimerRef.current = null;
    }
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      void quickDropToDirectory(Array.from(files), node.path, t as Parameters<typeof quickDropToDirectory>[2]);
    }
  }, [node.path, t, clearAutoExpand]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoExpandTimerRef.current) clearTimeout(autoExpandTimerRef.current);
      if (dragLeaveTimerRef.current) clearTimeout(dragLeaveTimerRef.current);
    };
  }, []);

  return {
    isDragTarget,
    handleRowDragOver,
    handleRowDragEnter,
    handleRowDragLeave,
    handleRowDrop,
  };
}
