export type ConnectionIssueReason =
  | 'invalid_url'
  | 'unreachable'
  | 'auth_required'
  | 'api_unavailable'
  | 'connection_lost'
  | 'saved_unreachable'
  | 'secure_storage_unavailable'
  | 'unknown';

export type ConnectionTone = 'success' | 'warning' | 'error' | 'muted';

export interface ConnectionDiagnosticState {
  reason: ConnectionIssueReason;
  message?: string;
  checkedAt?: number;
}

export interface FormattedConnectionDiagnostic {
  title: string;
  message: string;
  actionLabel: string;
  tone: ConnectionTone;
}

export function formatConnectionDiagnostic(
  diagnostic?: ConnectionDiagnosticState,
): FormattedConnectionDiagnostic {
  switch (diagnostic?.reason) {
    case 'invalid_url':
      return {
        title: 'Check the address',
        message: 'Enter a valid http:// or https:// MindOS server address.',
        actionLabel: 'Edit address',
        tone: 'error',
      };
    case 'unreachable':
      return {
        title: 'Server not reachable',
        message: 'Make sure MindOS is running and your phone is on the same network.',
        actionLabel: 'Retry',
        tone: 'error',
      };
    case 'auth_required':
      return {
        title: 'Token needed',
        message: 'Copy the API token from MindOS on your computer and try again.',
        actionLabel: 'Update token',
        tone: 'error',
      };
    case 'api_unavailable':
      return {
        title: 'API unavailable',
        message: compactMessage(
          diagnostic.message,
          'MindOS responded, but the mobile API is not available right now.',
        ),
        actionLabel: 'Retry',
        tone: 'error',
      };
    case 'connection_lost':
      return {
        title: 'Connection lost',
        message: compactMessage(
          diagnostic.message,
          'Reconnect when your computer and phone are back on the same network.',
        ),
        actionLabel: 'Retry',
        tone: 'warning',
      };
    case 'saved_unreachable':
      return {
        title: 'Saved server unavailable',
        message: 'The saved MindOS server could not be reached. Retry or choose another server.',
        actionLabel: 'Retry',
        tone: 'warning',
      };
    case 'secure_storage_unavailable':
      return {
        title: 'Token was not saved',
        message: 'Could not save the access token securely on this device.',
        actionLabel: 'Try again',
        tone: 'error',
      };
    case 'unknown':
      return {
        title: 'Connection needs attention',
        message: compactMessage(diagnostic.message, 'Try again or reconnect this device.'),
        actionLabel: 'Retry',
        tone: 'error',
      };
    default:
      return {
        title: 'Connection needs attention',
        message: 'Try again or reconnect this device.',
        actionLabel: 'Retry',
        tone: 'error',
      };
  }
}

export function formatApiAccessError(reason: 'auth_required' | 'unreachable'): ConnectionDiagnosticState {
  return reason === 'auth_required'
    ? { reason: 'auth_required' }
    : { reason: 'api_unavailable' };
}

export function formatLastCheckedAt(timestamp?: number, now = Date.now()): string {
  if (!timestamp) return 'Not checked yet';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function compactMessage(message: string | undefined, fallback: string): string {
  const trimmed = message?.trim();
  if (!trimmed) return fallback;
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}
