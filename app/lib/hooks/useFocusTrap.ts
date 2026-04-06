'use client';

import { useEffect, useRef } from 'react';

/**
 * Focus trap hook: keeps Tab navigation within a dialog/modal.
 * Wraps focus from last focusable element back to first, and vice versa.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled || !ref.current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = ref.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) as NodeListOf<HTMLElement>;

      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab on first element -> focus last
        if (activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab on last element -> focus first
        if (activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    const container = ref.current;
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [ref, enabled]);
}

/**
 * Return focus hook: saves reference to trigger element and restores focus on unmount
 */
export function useReturnFocus() {
  const triggerRef = useRef<HTMLElement | null>(null);

  const saveTrigger = (el: HTMLElement | null) => {
    triggerRef.current = el;
  };

  useEffect(() => {
    return () => {
      // Return focus on unmount
      triggerRef.current?.focus();
    };
  }, []);

  return saveTrigger;
}
