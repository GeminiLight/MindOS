const FALLBACK_READ_ERROR = 'Unable to open this item';

export function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function getReadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return FALLBACK_READ_ERROR;
}

export function shouldShowFileNotFound(readError: unknown): boolean {
  return getErrorStatus(readError) === 404;
}

export function resolveReaderErrorMessage(readError: unknown): string {
  return shouldShowFileNotFound(readError) ? 'File not found' : getReadErrorMessage(readError);
}
