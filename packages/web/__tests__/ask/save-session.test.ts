import { describe, expect, it } from 'vitest';
import {
  generateSessionPath,
  formatSessionContent,
  sessionPreviewStats,
} from '@/components/ask/save-insight-utils';
import type { Message } from '@/lib/types';

const mockMessages: Message[] = [
  { role: 'user', content: 'What is React?' },
  { role: 'assistant', content: 'React is a JavaScript library for building UIs.' },
  { role: 'user', content: 'What about hooks?' },
  { role: 'assistant', content: '<thinking>Let me explain hooks.</thinking>Hooks are functions that let you use state in function components.' },
];

describe('generateSessionPath', () => {
  it('generates date-based session path', () => {
    const path = generateSessionPath(new Date('2026-04-10'));
    expect(path).toBe('Inbox/session-2026-04-10.md');
  });
});

describe('formatSessionContent', () => {
  it('formats full conversation with role headers', () => {
    const result = formatSessionContent(mockMessages, 'full', new Date('2026-04-10'));
    expect(result).toContain('> Saved session from MindOS Ask');
    expect(result).toContain('### **User**');
    expect(result).toContain('What is React?');
    expect(result).toContain('### **Assistant**');
    expect(result).toContain('React is a JavaScript library');
    expect(result).toContain('---');
  });

  it('strips thinking tags in full format', () => {
    const result = formatSessionContent(mockMessages, 'full', new Date('2026-04-10'));
    expect(result).not.toContain('<thinking>');
    expect(result).toContain('Hooks are functions');
  });

  it('formats AI-only with just assistant messages', () => {
    const result = formatSessionContent(mockMessages, 'ai-only', new Date('2026-04-10'));
    expect(result).toContain('React is a JavaScript library');
    expect(result).toContain('Hooks are functions');
    expect(result).not.toContain('What is React?');
    expect(result).not.toContain('What about hooks?');
  });

  it('handles empty messages array', () => {
    const result = formatSessionContent([], 'full', new Date('2026-04-10'));
    expect(result).toContain('> Saved session from MindOS Ask');
  });
});

describe('sessionPreviewStats', () => {
  it('counts all messages for full format', () => {
    const stats = sessionPreviewStats(mockMessages, 'full');
    expect(stats.msgCount).toBe(4);
    expect(stats.charCount).toBeGreaterThan(0);
  });

  it('counts only assistant messages for ai-only format', () => {
    const stats = sessionPreviewStats(mockMessages, 'ai-only');
    expect(stats.msgCount).toBe(2);
    expect(stats.charCount).toBeGreaterThan(0);
  });

  it('excludes thinking tags from char count', () => {
    const stats = sessionPreviewStats(mockMessages, 'ai-only');
    // The thinking tag content should not be counted
    const fullStats = sessionPreviewStats(mockMessages, 'full');
    expect(fullStats.charCount).toBeGreaterThan(stats.charCount);
  });
});
