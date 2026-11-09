import path from 'path';
import os from 'os';

export function getDesktopHome(): string {
  const override = process.env.MINDOS_DESKTOP_HOME_DIR?.trim();
  if (override) return override;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: also runs outside Electron (scripts, unit tests), where this throws and we fall back
    const { app } = require('electron') as typeof import('electron');
    return app.getPath('home');
  } catch {
    return process.env.HOME || process.env.USERPROFILE || os.homedir();
  }
}

export function getDesktopConfigDir(): string {
  return path.join(getDesktopHome(), '.mindos');
}
