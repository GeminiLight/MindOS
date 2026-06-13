/**
 * Byte formatting shared by API-route helpers.
 *
 * Historical note: this module used to also export ETag/Cache-Control helpers
 * (generateETag, setPublicCacheHeaders, ...). No route ever referenced them,
 * so they were removed during the data-fetching perf hardening pass; only
 * formatBytes (used by api-file-size-validation) remains.
 */

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
