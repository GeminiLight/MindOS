/**
 * Time utilities
 */

import type { Timestamp, ISODateString } from '../types/index.js'

/**
 * Get current timestamp in milliseconds
 */
export function now(): Timestamp {
  return Date.now()
}

/**
 * Convert timestamp to ISO date string
 */
export function toISOString(timestamp: Timestamp): ISODateString {
  return new Date(timestamp).toISOString()
}

/**
 * Convert ISO date string to timestamp
 */
export function fromISOString(dateString: ISODateString): Timestamp {
  return new Date(dateString).getTime()
}

/**
 * Format timestamp to human-readable string
 */
export function formatTimestamp(timestamp: Timestamp, locale = 'en-US'): string {
  return new Date(timestamp).toLocaleString(locale)
}

/**
 * Get relative time string (e.g., "2 hours ago")
 */
export function getRelativeTime(timestamp: Timestamp, locale = 'en-US'): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diff = timestamp - now()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (Math.abs(days) > 0) return rtf.format(days, 'day')
  if (Math.abs(hours) > 0) return rtf.format(hours, 'hour')
  if (Math.abs(minutes) > 0) return rtf.format(minutes, 'minute')
  return rtf.format(seconds, 'second')
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
