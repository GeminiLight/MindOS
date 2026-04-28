import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateMindRootPath, expandSetupPathHome } from '@/app/api/setup/path-utils';
import { homedir } from 'node:os';
import path from 'node:path';

describe('path-utils', () => {
  describe('expandSetupPathHome', () => {
    it('expands ~ to home directory', () => {
      expect(expandSetupPathHome('~')).toBe(homedir());
    });

    it('expands ~/path to home/path', () => {
      expect(expandSetupPathHome('~/MindOS/mind')).toBe(path.resolve(homedir(), 'MindOS', 'mind'));
    });

    it('returns absolute paths unchanged', () => {
      expect(expandSetupPathHome('/usr/local/share')).toBe('/usr/local/share');
    });
  });

  describe('validateMindRootPath', () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      process.env = { ...originalEnv };
    });

    describe('cross-platform: ~/.mindos/', () => {
      it('rejects ~/.mindos directory', () => {
        const result = validateMindRootPath(path.join(homedir(), '.mindos'));
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('system directory');
      });

      it('rejects ~/.mindos/runtime', () => {
        const result = validateMindRootPath(path.join(homedir(), '.mindos', 'runtime'));
        expect(result.safe).toBe(false);
      });

      it('rejects ~/.mindos/config.json subdirectory', () => {
        const result = validateMindRootPath(path.join(homedir(), '.mindos', 'config', 'kb'));
        expect(result.safe).toBe(false);
      });
    });

    describe('Windows-specific', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        process.env.APPDATA = 'C:/Users/Test/AppData/Roaming';
        process.env.LOCALAPPDATA = 'C:/Users/Test/AppData/Local';
        process.env.ProgramFiles = 'C:/Program Files';
        process.env['ProgramFiles(x86)'] = 'C:/Program Files (x86)';
      });

      it('rejects AppData/MindOS', () => {
        const result = validateMindRootPath('C:/Users/Test/AppData/Roaming/mindos/kb');
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('Electron app data');
      });

      it('rejects LocalAppData/MindOS', () => {
        const result = validateMindRootPath('C:/Users/Test/AppData/Local/mindos/data');
        expect(result.safe).toBe(false);
      });

      it('rejects Program Files', () => {
        const result = validateMindRootPath('C:/Program Files/MindOS/data');
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('Program Files');
      });

      it('rejects Program Files (x86)', () => {
        const result = validateMindRootPath('C:/Program Files (x86)/MindOS/kb');
        expect(result.safe).toBe(false);
      });

      it('allows D:/MindOS/mind', () => {
        const result = validateMindRootPath('D:/MindOS/mind');
        expect(result.safe).toBe(true);
      });

      it('allows C:/Users/Test/Documents/MindOS', () => {
        const result = validateMindRootPath('C:/Users/Test/Documents/MindOS');
        expect(result.safe).toBe(true);
      });
    });

    describe('macOS-specific', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
      });

      it('rejects paths inside .app bundles', () => {
        const result = validateMindRootPath('/Applications/MindOS.app/Contents/Resources/kb');
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('.app bundle');
      });

      it('rejects /Applications/MindOS', () => {
        const result = validateMindRootPath('/Applications/MindOS/data');
        expect(result.safe).toBe(false);
      });

      it('allows ~/MindOS/mind', () => {
        const result = validateMindRootPath(path.join(homedir(), 'MindOS', 'mind'));
        expect(result.safe).toBe(true);
      });

      it('allows ~/Documents/MindOS', () => {
        const result = validateMindRootPath(path.join(homedir(), 'Documents', 'MindOS'));
        expect(result.safe).toBe(true);
      });
    });

    describe('Linux-specific', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
      });

      it('rejects /opt/MindOS', () => {
        const result = validateMindRootPath('/opt/mindos/data');
        expect(result.safe).toBe(false);
      });

      it('rejects /usr/share/MindOS', () => {
        const result = validateMindRootPath('/usr/share/mindos/kb');
        expect(result.safe).toBe(false);
      });

      it('allows ~/MindOS/mind', () => {
        const result = validateMindRootPath(path.join(homedir(), 'MindOS', 'mind'));
        expect(result.safe).toBe(true);
      });
    });

    describe('dynamic Desktop install directory', () => {
      afterEach(() => {
        delete process.env.MINDOS_INSTALL_DIR;
      });

      it('rejects install directory itself', () => {
        process.env.MINDOS_INSTALL_DIR = 'D:/MindOS';
        const result = validateMindRootPath('D:/MindOS');
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('installation directory');
      });

      it('rejects paths inside install directory', () => {
        process.env.MINDOS_INSTALL_DIR = 'D:/MindOS';
        const result = validateMindRootPath('D:/MindOS/data/kb');
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('reinstalling or uninstalling');
      });

      it('allows sibling paths outside install directory', () => {
        process.env.MINDOS_INSTALL_DIR = 'D:/MindOS';
        const result = validateMindRootPath('D:/MindOS-Data/kb');
        expect(result.safe).toBe(true);
      });

      it('allows safe user data paths when install dir is set', () => {
        process.env.MINDOS_INSTALL_DIR = 'D:/MindOS';
        const result = validateMindRootPath('D:/MyNotes/MindOS');
        expect(result.safe).toBe(true);
      });
    });

    describe('safe paths', () => {
      it('allows default ~/MindOS/mind', () => {
        const result = validateMindRootPath(path.join(homedir(), 'MindOS', 'mind'));
        expect(result.safe).toBe(true);
      });

      it('allows ~/Documents/notes', () => {
        const result = validateMindRootPath(path.join(homedir(), 'Documents', 'notes'));
        expect(result.safe).toBe(true);
      });

      it('allows /data/kb on Linux', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const result = validateMindRootPath('/data/kb');
        expect(result.safe).toBe(true);
      });
    });
  });
});
