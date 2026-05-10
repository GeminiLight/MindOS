import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path, { join, resolve } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';

export interface PathValidationResult {
  safe: boolean;
  reason?: string;
  reasonZh?: string;
}

export interface SetupCheckPathPayload {
  exists: boolean;
  empty: boolean;
  count: number;
  unsafe: boolean;
  reason?: string;
  reasonZh?: string;
}

export interface SetupListDirectoriesPayload {
  dirs: string[];
}

export type SetupPathOptions = {
  homeDir?: string;
};

export function expandSetupPathHome(input: string, options: SetupPathOptions = {}): string {
  const home = options.homeDir ?? homedir();
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith('~\\')) return resolve(home, input.slice(2));
  return input;
}

export function validateMindRootPath(absPath: string, options: SetupPathOptions = {}): PathValidationResult {
  const normalized = normalizeForPathCheck(absPath);
  const home = options.homeDir ?? homedir();
  const homeNorm = normalizeForPathCheck(home);

  if (!isSetupPathAbsolute(absPath)) {
    return {
      safe: false,
      reason: 'Knowledge base path must be an absolute path or start with ~/.',
      reasonZh: '知识库路径必须是绝对路径，或以 ~/ 开头。',
    };
  }

  const mindosDir = `${homeNorm}/.mindos`;
  if (isSameOrSubPath(normalized, mindosDir)) {
    return {
      safe: false,
      reason: 'Cannot use ~/.mindos/ - this is the MindOS system directory (config, cache, updater). It gets modified during updates.',
      reasonZh: '不能使用 ~/.mindos/ 目录——这是 MindOS 系统目录（配置、缓存、更新器），更新时会被修改。',
    };
  }

  if (process.platform === 'win32') {
    const appData = normalizeForPathCheck(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'));
    const localAppData = normalizeForPathCheck(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'));
    const electronUserData = `${appData}/mindos`;
    const electronLocalData = `${localAppData}/mindos`;
    if (isSameOrSubPath(normalized, electronUserData) || isSameOrSubPath(normalized, electronLocalData)) {
      return {
        safe: false,
        reason: 'Cannot use AppData\\MindOS - this is the Electron app data directory. It may be cleared when uninstalling.',
        reasonZh: '不能使用 AppData\\MindOS 目录——这是 Electron 应用数据目录，卸载时可能被清除。',
      };
    }

    const programFiles = normalizeForPathCheck(process.env.ProgramFiles || 'C:\\Program Files');
    const programFilesX86 = normalizeForPathCheck(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
    if (isSameOrSubPath(normalized, programFiles) || isSameOrSubPath(normalized, programFilesX86)) {
      return {
        safe: false,
        reason: 'Cannot use Program Files - this is the Windows application directory. It gets cleared when reinstalling apps.',
        reasonZh: '不能使用 Program Files 目录——这是 Windows 应用程序目录，重装时会被清除。',
      };
    }
  }

  if (process.platform === 'darwin') {
    if (normalized.includes('.app/') || normalized.endsWith('.app')) {
      return {
        safe: false,
        reason: 'Cannot use a path inside an .app bundle - it gets replaced when updating the app.',
        reasonZh: '不能使用 .app 包内的路径——更新应用时会被替换。',
      };
    }
    if (normalized.startsWith('/applications/mindos')) {
      return {
        safe: false,
        reason: 'Cannot use /Applications/MindOS - this is the app install location. Use ~/MindOS/mind or ~/Documents instead.',
        reasonZh: '不能使用 /Applications/MindOS——这是应用安装位置。请使用 ~/MindOS/mind 或 ~/Documents。',
      };
    }
  }

  if (process.platform === 'linux') {
    if (normalized.startsWith('/opt/mindos') || normalized.startsWith('/usr/share/mindos')) {
      return {
        safe: false,
        reason: 'Cannot use /opt/MindOS or /usr/share/MindOS - these are system install directories. Use ~/MindOS/mind instead.',
        reasonZh: '不能使用 /opt/MindOS 或 /usr/share/MindOS——这些是系统安装目录。请使用 ~/MindOS/mind。',
      };
    }
  }

  const installDir = process.env.MINDOS_INSTALL_DIR;
  if (installDir) {
    const installDirNorm = normalizeForPathCheck(installDir);
    if (isSameOrSubPath(normalized, installDirNorm)) {
      return {
        safe: false,
        reason: 'Cannot use a path inside the MindOS Desktop installation directory - it gets deleted when reinstalling or uninstalling the app.',
        reasonZh: '不能使用 MindOS Desktop 安装目录内的路径——重装或卸载应用时会被删除。',
      };
    }
  }

  return { safe: true };
}

export function handleSetupCheckPath(
  body: unknown,
  options: SetupPathOptions = {},
): MindosServerResponse<SetupCheckPathPayload | { error: string }> {
  const requestedPath = body && typeof body === 'object' ? (body as { path?: unknown }).path : undefined;
  if (!requestedPath || typeof requestedPath !== 'string') {
    return json({ error: 'Invalid path' }, { status: 400 });
  }

  const abs = expandSetupPathHome(requestedPath.trim(), options);
  const validation = validateMindRootPath(abs, options);
  if (!validation.safe) {
    return json({
      exists: false,
      empty: true,
      count: 0,
      unsafe: true,
      reason: validation.reason,
      reasonZh: validation.reasonZh,
    });
  }

  const exists = existsSync(abs);
  let empty = true;
  let count = 0;
  if (exists) {
    try {
      const entries = readdirSync(abs).filter((entry) => !entry.startsWith('.'));
      count = entries.length;
      empty = count === 0;
    } catch {
      empty = false;
    }
  }

  return json({ exists, empty, count, unsafe: false });
}

export function handleSetupListDirectories(
  body: unknown,
  options: SetupPathOptions = {},
): MindosServerResponse<SetupListDirectoriesPayload> {
  const requestedPath = body && typeof body === 'object' ? (body as { path?: unknown }).path : undefined;
  if (!requestedPath || typeof requestedPath !== 'string') {
    return json({ dirs: [] });
  }

  const abs = expandSetupPathHome(requestedPath.trim(), options);
  if (!isSetupPathAbsolute(abs)) {
    return json({ dirs: [] });
  }
  if (!existsSync(abs)) {
    return json({ dirs: [] });
  }

  try {
    const dirs = readdirSync(abs)
      .filter((entry) => !entry.startsWith('.'))
      .filter((entry) => {
        try {
          return statSync(join(abs, entry)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .slice(0, 20);
    return json({ dirs });
  } catch {
    return json({ dirs: [] });
  }
}

function normalizeForPathCheck(input: string): string {
  return path.normalize(input).toLowerCase().replace(/\\/g, '/');
}

function isSetupPathAbsolute(input: string): boolean {
  return path.isAbsolute(input) || path.win32.isAbsolute(input);
}

function isSameOrSubPath(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}
