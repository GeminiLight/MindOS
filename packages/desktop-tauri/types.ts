/**
 * Type definitions for Desktop Tauri spike
 *
 * This file defines the contract between Rust backend and TypeScript frontend.
 */

/**
 * Tauri Commands - invoked from frontend via window.__TAURI__.invoke()
 */
export interface TauriCommands {
  /**
   * Show or hide the main window
   */
  toggle_window(): Promise<void>;

  /**
   * Get application version
   */
  get_app_version(): Promise<string>;

  /**
   * Check if runtime is healthy
   */
  check_runtime_health(): Promise<RuntimeHealth>;

  /**
   * Start MindOS runtime (Node.js sidecar)
   */
  start_runtime(): Promise<void>;

  /**
   * Stop MindOS runtime
   */
  stop_runtime(): Promise<void>;
}

/**
 * Runtime health status
 */
export interface RuntimeHealth {
  running: boolean;
  port: number;
  version?: string;
  error?: string;
}

/**
 * Application configuration
 */
export interface AppConfig {
  /**
   * Runtime port (default: 3456)
   */
  port: number;

  /**
   * Auto-start runtime on app launch
   */
  autoStart: boolean;

  /**
   * Window settings
   */
  window: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };

  /**
   * Tray settings
   */
  tray: {
    enabled: boolean;
    minimizeToTray: boolean;
  };
}

/**
 * Tauri events - emitted from Rust backend
 */
export enum TauriEvent {
  RUNTIME_STARTED = 'runtime:started',
  RUNTIME_STOPPED = 'runtime:stopped',
  RUNTIME_ERROR = 'runtime:error',
  WINDOW_FOCUS = 'window:focus',
  WINDOW_BLUR = 'window:blur',
}

/**
 * Event payloads
 */
export interface RuntimeStartedPayload {
  port: number;
  pid: number;
}

export interface RuntimeStoppedPayload {
  code: number;
  signal?: string;
}

export interface RuntimeErrorPayload {
  message: string;
  code?: string;
}
