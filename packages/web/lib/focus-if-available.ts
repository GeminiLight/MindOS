/** Deferred composer focus must not escape a modal that opened in the meantime. */
export function focusIfAvailable(element: HTMLElement | null, onlyIfUnfocused = false): void {
  if (!element?.isConnected || element.closest('[inert], [aria-hidden="true"]')) return;
  const doc = element.ownerDocument;
  if (onlyIfUnfocused && doc.activeElement && doc.activeElement !== doc.body && doc.activeElement !== element) return;
  element.focus();
}
