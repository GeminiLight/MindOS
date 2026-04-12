/**
 * Request timeout utilities for API safety.
 * 
 * Provides timeout wrappers to prevent indefinite hangs in API routes,
 * with proper error handling and resource cleanup.
 */

/**
 * Race a promise against a timeout. Throws TimeoutError if timeout is exceeded.
 * 
 * @param promise - The async operation to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message for timeout
 * @returns The result of the promise if it completes before timeout
 * @throws Error with "TIMEOUT" code if promise exceeds timeoutMs
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timeout',
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(errorMessage);
      (err as any).code = 'TIMEOUT';
      reject(err);
    }, timeoutMs);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/**
 * Check if an error is a timeout error produced by withTimeout().
 * Only matches errors with the TIMEOUT code set by this module,
 * NOT generic errors that happen to mention "timeout" in the message.
 */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    return (err as any).code === 'TIMEOUT';
  }
  return false;
}
