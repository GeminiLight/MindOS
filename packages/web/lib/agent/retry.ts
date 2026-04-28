/**
 * Detect transient errors that are safe to retry: timeouts, rate limits (429),
 * and server errors (5xx). Auth errors (401/403), bad requests (400), and
 * content policy violations should NOT be retried.
 */
export function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  // Timeout patterns
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return true;
  // Rate limiting
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true;
  // Server errors (5xx)
  if (/\b5\d{2}\b/.test(msg) || msg.includes('internal server error') || msg.includes('service unavailable')) return true;
  // Connection errors
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('socket hang up')) return true;
  // Overloaded
  if (msg.includes('overloaded') || msg.includes('capacity')) return true;
  return false;
}
