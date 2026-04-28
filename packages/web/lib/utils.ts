import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Encode a relative file path for use in URLs.
 * Each segment is individually URI-encoded.
 */
export function encodePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Format a timestamp as a human-readable relative time string.
 */
export function relativeTime(mtime: number, labels: {
  justNow: string;
  minutesAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  daysAgo: (n: number) => string;
}): string {
  const diff = Date.now() - mtime;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return labels.justNow;
  if (minutes < 60) return labels.minutesAgo(minutes);
  if (hours < 24) return labels.hoursAgo(hours);
  if (days < 7) return labels.daysAgo(days);
  return new Date(mtime).toLocaleDateString();
}

/** Extract leading emoji from a string, e.g. "📝 Notes" → "📝" */
export function extractEmoji(name: string): string {
  const match = name.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u);
  return match?.[0] ?? '';
}

/** Strip leading emoji+space from a string, e.g. "📝 Notes" → "Notes" */
export function stripEmoji(name: string): string {
  return name.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || name;
}
