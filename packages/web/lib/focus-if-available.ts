/** Deferred composer focus must not escape a modal that opened in the meantime. */
export function focusIfAvailable(element: HTMLElement | null, onlyIfUnfocused = false): void {
  if (!element?.isConnected || element.closest('[inert], [aria-hidden="true"]')) return;
  const doc = element.ownerDocument;
  if (onlyIfUnfocused && doc.activeElement && doc.activeElement !== doc.body && doc.activeElement !== element) return;
  element.focus();
}

/** Long imported drafts open at their goal, while typed edits keep their caret. */
export function focusPreparedDraft(element: HTMLTextAreaElement | null, expectedText: string): void {
  if (!element || element.value !== expectedText) return;
  focusIfAvailable(element);
  if (element.ownerDocument.activeElement !== element || expectedText.split('\n').length <= 8) return;
  element.setSelectionRange(0, 0);
  element.scrollTop = 0;
}
