/**
 * HTTP Cache header utilities for API responses.
 * 
 * Provides utilities to set Cache-Control and ETag headers on Next.js responses.
 * Follows HTTP/1.1 cache semantics for browser caching.
 */

import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Generate an ETag from content string using SHA-256 hash.
 * Uses first 12 hex chars (48 bits) — sufficient for cache invalidation
 * while keeping header size small.
 * 
 * @param content - String content to hash
 * @returns ETag string (quoted per HTTP spec)
 */
export function generateETag(content: string): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `"${hash.slice(0, 12)}"`;
}

/**
 * Generate an ETag from a JSON-serializable object.
 * 
 * @param obj - Object to serialize and hash
 * @returns ETag string (quoted per HTTP spec)
 */
export function generateJsonETag(obj: Record<string, unknown>): string {
  return generateETag(JSON.stringify(obj));
}

/**
 * Set cache headers on a response for public cacheable data.
 * 
 * Note: Routes using this still set `export const dynamic = 'force-dynamic'`
 * so Next.js always runs the handler. These headers control *browser* caching only —
 * the browser may serve from cache without hitting the server at all until max-age expires.
 * 
 * @param response - NextResponse to modify
 * @param maxAgeSeconds - Browser cache duration in seconds
 * @param etag - Optional ETag for revalidation
 * @returns The modified response
 */
export function setPublicCacheHeaders(
  response: NextResponse,
  maxAgeSeconds: number,
  etag?: string,
): NextResponse {
  response.headers.set('Cache-Control', `public, max-age=${maxAgeSeconds}`);
  if (etag) {
    response.headers.set('ETag', etag);
  }
  return response;
}

/**
 * Set cache headers on a response for private (user-specific) cacheable data.
 * Prevents CDN/proxy caching but allows browser cache.
 * 
 * @param response - NextResponse to modify
 * @param maxAgeSeconds - Browser cache duration in seconds
 * @param etag - Optional ETag for revalidation
 * @returns The modified response
 */
export function setPrivateCacheHeaders(
  response: NextResponse,
  maxAgeSeconds: number,
  etag?: string,
): NextResponse {
  response.headers.set('Cache-Control', `private, max-age=${maxAgeSeconds}`);
  if (etag) {
    response.headers.set('ETag', etag);
  }
  return response;
}

/**
 * Format bytes into human-readable format.
 * 
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "10.0 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}
