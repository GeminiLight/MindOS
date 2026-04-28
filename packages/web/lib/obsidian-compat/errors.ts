/**
 * Obsidian Plugin Compatibility - Errors
 */

export class CompatError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CompatError';
  }
}

export const CompatErrorCodes = {
  PLUGIN_NOT_FOUND: 'PLUGIN_NOT_FOUND',
  MANIFEST_INVALID: 'MANIFEST_INVALID',
  MANIFEST_READ_FAILED: 'MANIFEST_READ_FAILED',
  MODULE_LOAD_FAILED: 'MODULE_LOAD_FAILED',
  MODULE_NOT_SUPPORTED: 'MODULE_NOT_SUPPORTED',
  PLUGIN_RUNTIME_ERROR: 'PLUGIN_RUNTIME_ERROR',
  DATA_FILE_READ_FAILED: 'DATA_FILE_READ_FAILED',
  DATA_FILE_WRITE_FAILED: 'DATA_FILE_WRITE_FAILED',
  PLUGIN_ALREADY_LOADED: 'PLUGIN_ALREADY_LOADED',
  PLUGIN_NOT_LOADED: 'PLUGIN_NOT_LOADED',
};
