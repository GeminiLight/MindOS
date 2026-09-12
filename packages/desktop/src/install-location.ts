interface InstallLocationOptions {
  platform: string;
  packaged: boolean;
  exe: string;
  locale: string;
  smoke: boolean;
  move: () => boolean;
  prompt: (options: { title: string; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }) => Promise<number>;
  showError: (message: string) => Promise<void>;
  quit: () => void;
}
/** Only transient macOS mounts need guidance; custom writable app folders remain supported. */
export async function ensureInstallLocation(opts: InstallLocationOptions): Promise<boolean> {
  if (opts.platform !== 'darwin' || !opts.packaged || opts.smoke) return true;
  if (!opts.exe.startsWith('/Volumes/') && !opts.exe.includes('/AppTranslocation/')) return true;
  const zh = opts.locale.startsWith('zh');
  const choice = await opts.prompt({
    title: 'MindOS',
    message: zh ? '将 MindOS 移到「应用程序」？' : 'Move MindOS to Applications?',
    detail: zh ? '安装后可以稳定使用应用更新和终端命令。你的笔记和设置会保留。' : 'Installing provides a stable location for updates and terminal commands. Your notes and settings will be kept.',
    buttons: zh ? ['移到应用程序', '本次继续运行', '退出'] : ['Move to Applications', 'Continue This Time', 'Quit'],
    defaultId: 0,
    cancelId: 2,
  });
  if (choice === 1) return true;
  if (choice === 0) {
    try {
      if (opts.move()) return false; // Electron relaunches the installed copy.
      throw new Error(zh ? '未能移动应用。请将 MindOS 拖到应用程序后再打开。' : 'The app could not be moved. Drag MindOS to Applications and reopen it.');
    } catch (error) {
      await opts.showError(error instanceof Error ? error.message : String(error));
    }
  }
  opts.quit();
  return false;
}
