/**
 * UUID utilities
 */

import { randomBytes } from 'node:crypto'
import type { UUID } from '../types/index.js'

/**
 * Generate a v4 UUID
 */
export function generateUUID(): UUID {
  const bytes = randomBytes(16)

  // Set version (4) and variant bits
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Validate UUID format
 */
export function isValidUUID(value: string): value is UUID {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

/**
 * Generate a short ID (8 characters)
 */
export function generateShortId(): string {
  return randomBytes(4).toString('hex')
}
