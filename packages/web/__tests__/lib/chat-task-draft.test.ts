// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { offerTaskDraft, takeTaskDraft } from '@/lib/chat-task-draft';
beforeEach(() => sessionStorage.clear());
it('delivers a prepared draft only to its matching conversation, once', () => {
  offerTaskDraft('chat-a', 'Review this candidate');
  expect(takeTaskDraft('chat-b')).toBeNull();
  expect(takeTaskDraft('chat-a')).toBe('Review this candidate');
  expect(takeTaskDraft('chat-a')).toBeNull();
});
it('retains a queued draft across navigation and rejects empty or oversized payloads', () => {
  expect(offerTaskDraft('', 'Hello')).toBe(false);
  expect(offerTaskDraft('a', 'x'.repeat(24001))).toBe(false);
  expect(offerTaskDraft('a', 'Hello')).toBe(true);
  expect(sessionStorage.getItem('mindos:task-draft:a')).toContain('Hello');
  expect(takeTaskDraft('a')).toBe('Hello');
});
it('keeps an existing unsent task draft instead of silently overwriting it', () => {
  expect(offerTaskDraft('a', 'First request')).toBe(true);
  expect(offerTaskDraft('a', 'Second request')).toBe(false);
  expect(takeTaskDraft('a')).toBe('First request');
});
