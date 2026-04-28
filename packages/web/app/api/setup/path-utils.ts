import { homedir } from 'node:os';
import path, { resolve } from 'node:path';

export function expandSetupPathHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homedir(), p.slice(2));
  return p;
}

/**
 * List of dangerous path prefixes where knowledge base should NEVER be placed.
 * These paths get cleared during install/update/uninstall and would cause data loss.
 * 
 * Windows:
 *   - %APPDATA%\MindOS     (Electron userData, may be cleared on uninstall)
 *   - %LOCALAPPDATA%\MindOS
 *   - Program Files        (install directories, cleared on reinstall)
 *   - ~/.mindos/runtime    (updater-managed, cleared on core update)
 * 
 * macOS/Linux:
 *   - ~/.mindos/runtime    (updater-managed)
 *   - /Applications/MindOS.app (install directory)
 *   - /opt/MindOS          (Linux install directory)
 */
export interface PathValidationResult {
  safe: boolean;
  reason?: string;
  reasonZh?: string;
}

function normalizeForPathCheck(p: string): string {
  return path.normalize(p).toLowerCase().replace(/\\/g, '/');
}

function isSameOrSubPath(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(parent + '/');
}

/**
 * Check if a knowledge base path is safe (not inside install/system directories).
 * Returns { safe: true } if OK, or { safe: false, reason, reasonZh } if dangerous.
 */
export function validateMindRootPath(absPath: string): PathValidationResult {
  const normalized = normalizeForPathCheck(absPath);
  const home = homedir();
  const homeNorm = normalizeForPathCheck(home);

  // ── 1. ~/.mindos/ system directory (updater, config, cache) ──
  const mindosDir = homeNorm + '/.mindos';
  if (isSameOrSubPath(normalized, mindosDir)) {
    return {
      safe: false,
      reason: 'Cannot use ~/.mindos/ — this is the MindOS system directory (config, cache, updater). It gets modified during updates.',
      reasonZh: '不能使用 ~/.mindos/ 目录——这是 MindOS 系统目录（配置、缓存、更新器），更新时会被修改。',
    };
  }

  // ── 2. Windows-specific dangerous paths ──
  if (process.platform === 'win32') {
    const appData = normalizeForPathCheck(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'));
    const localAppData = normalizeForPathCheck(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'));

    // Electron userData: %APPDATA%\MindOS or %LOCALAPPDATA%\MindOS
    const electronUserData = appData + '/mindos';
    const electronLocalData = localAppData + '/mindos';
    if (isSameOrSubPath(normalized, electronUserData) || isSameOrSubPath(normalized, electronLocalData)) {
      return {
        safe: false,
        reason: 'Cannot use AppData\\MindOS — this is the Electron app data directory. It may be cleared when uninstalling.',
        reasonZh: '不能使用 AppData\\MindOS 目录——这是 Electron 应用数据目录，卸载时可能被清除。',
      };
    }

    // Program Files (default and x86)
    const programFiles = normalizeForPathCheck(process.env.ProgramFiles || 'C:\\Program Files');
    const programFilesX86 = normalizeForPathCheck(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
    if (isSameOrSubPath(normalized, programFiles) || isSameOrSubPath(normalized, programFilesX86)) {
      return {
        safe: false,
        reason: 'Cannot use Program Files — this is the Windows application directory. It gets cleared when reinstalling apps.',
        reasonZh: '不能使用 Program Files 目录——这是 Windows 应用程序目录，重装时会被清除。',
      };
    }
  }

  // ── 3. macOS .app bundle ──
  if (process.platform === 'darwin') {
    if (normalized.includes('.app/') || normalized.endsWith('.app')) {
      return {
        safe: false,
        reason: 'Cannot use a path inside an .app bundle — it gets replaced when updating the app.',
        reasonZh: '不能使用 .app 包内的路径——更新应用时会被替换。',
      };
    }
    // /Applications/MindOS.app adjacent directory
    if (normalized.startsWith('/applications/mindos')) {
      return {
        safe: false,
        reason: 'Cannot use /Applications/MindOS — this is the app install location. Use ~/MindOS/mind or ~/Documents instead.',
        reasonZh: '不能使用 /Applications/MindOS——这是应用安装位置。请使用 ~/MindOS/mind 或 ~/Documents。',
      };
    }
  }

  // ── 4. Linux install directories ──
  if (process.platform === 'linux') {
    if (normalized.startsWith('/opt/mindos') || normalized.startsWith('/usr/share/mindos')) {
      return {
        safe: false,
        reason: 'Cannot use /opt/MindOS or /usr/share/MindOS — these are system install directories. Use ~/MindOS/mind instead.',
        reasonZh: '不能使用 /opt/MindOS 或 /usr/share/MindOS——这些是系统安装目录。请使用 ~/MindOS/mind。',
      };
    }
  }

  // ── 5. Actual Desktop install directory (dynamic, covers custom install paths) ──
  const installDir = process.env.MINDOS_INSTALL_DIR;
  if (installDir) {
    const installDirNorm = normalizeForPathCheck(installDir);
    if (isSameOrSubPath(normalized, installDirNorm)) {
      return {
        safe: false,
        reason: 'Cannot use a path inside the MindOS Desktop installation directory — it gets deleted when reinstalling or uninstalling the app.',
        reasonZh: '不能使用 MindOS Desktop 安装目录内的路径——重装或卸载应用时会被删除。',
      };
    }
  }

  return { safe: true };
}
