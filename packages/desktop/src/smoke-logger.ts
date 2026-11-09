/**
 * Opt-in file logger for packaged smoke runs (MINDOS_DESKTOP_CI_LOG).
 *
 * Extracted from main.ts. Wraps console so a packaged app's diagnostics land
 * somewhere CI can read; must never affect normal startup.
 */
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { inspect } from 'util';

export function installSmokeFileLogger(): void {
  const logPath = process.env.MINDOS_DESKTOP_CI_LOG?.trim();
  if (!logPath) return;

  const write = (level: string, args: unknown[]) => {
    try {
      mkdirSync(path.dirname(logPath), { recursive: true });
      const line = args.map((arg) => {
        if (arg instanceof Error) return arg.stack || arg.message;
        if (typeof arg === 'string') return arg;
        return inspect(arg, { depth: 6, breakLength: 160 });
      }).join(' ');
      appendFileSync(logPath, `[desktop ${new Date().toISOString()} ${level}] ${line}\n`, 'utf-8');
    } catch {
      // Smoke diagnostics must never affect normal startup.
    }
  };

  const wrap = (level: 'log' | 'info' | 'warn' | 'error') => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      write(level, args);
      original(...args);
    };
  };

  wrap('log');
  wrap('info');
  wrap('warn');
  wrap('error');
  process.on('uncaughtException', (error) => write('uncaughtException', [error]));
  process.on('unhandledRejection', (reason) => write('unhandledRejection', [reason]));
  write('info', ['MindOS Desktop smoke file logger enabled']);
}
