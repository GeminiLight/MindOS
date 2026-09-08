import { dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareNativeObsidianPluginSession } from './obsidian-native-session';
import { createObsidianEditorWindow } from './obsidian-editor-window';
import { openObsidianDraftStore, type DraftRecord } from './obsidian-draft-store';
import { canRestoreObsidianDraft, createRecoverableObsidianSession } from './obsidian-recovery-session';
import { untilAbort } from './obsidian-response';

type Context = { window: BrowserWindow; baseUrl: string; token: string; isCurrent: () => boolean };

/** Main-owned entry. Renderer supplies only a plugin id and relative note path. */
export function createObsidianEditorLauncher(getContext: () => Context | null, artifactDirectory: string, recoveryDirectory: string) {
  let occupied = false;
  const pending = new Set<{ flush(): Promise<void> }>();
  const drain = (recovery: { flush(): Promise<void> }) => {
    void recovery.flush().then(() => pending.delete(recovery), () => { /* Retain failed journals for a quit-time retry. */ });
  };
  return {
    async flush() { await untilAbort(Promise.all([...pending].map(item => item.flush())), AbortSignal.timeout(5000)); },
    async open(event: IpcMainInvokeEvent, input: unknown): Promise<{ opened: boolean }> {
      const context = getContext();
      if (!context || !context.isCurrent() || context.window.isDestroyed()
        || event.sender !== context.window.webContents || event.senderFrame !== context.window.webContents.mainFrame) {
        throw new Error('Plugin editor requires the current local main window.');
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => key !== 'pluginId' && key !== 'filePath')) throw new Error('Invalid plugin editor request.');
      const { pluginId, filePath } = input as Record<string, unknown>;
      if (typeof pluginId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(pluginId)
        || typeof filePath !== 'string' || filePath.length > 1024 || !/\.md$/i.test(filePath)
        || /[\\:\x00-\x1f]/.test(filePath) || filePath.split('/').some(part => !part || part.startsWith('.'))) {
        throw new Error('Invalid plugin or Markdown document path.');
      }
      if (occupied) throw new Error('A plugin editor or approval is already open. Close it before opening another.');
      occupied = true;
      let approved: Awaited<ReturnType<typeof prepareNativeObsidianPluginSession>> = null;
      let recovery: ReturnType<typeof createRecoverableObsidianSession<NonNullable<typeof approved>>> | undefined;
      let opened = false;
      try {
        approved = await prepareNativeObsidianPluginSession({ ...context, pluginId, filePath });
        if (!approved) return { opened: false };
        const runtimeSource = await readFile(join(artifactDirectory, 'runtime.js'), 'utf8');
        const store = await openObsidianDraftStore(recoveryDirectory);
        const records = await store.list(approved.binding);
        let restored: DraftRecord | undefined;
        if (records.length) {
          const latest = records[0]; const matches = canRestoreObsidianDraft(approved, latest);
          const lifetime = new AbortController();
          const check = () => {
            try {
              if (context.isCurrent() && !context.window.isDestroyed() && approved?.snapshot.status !== 'closed') return;
            } catch { /* A failing owner predicate revokes the dialog too. */ }
            lifetime.abort(new Error('Recovery approval owner closed.'));
          };
          const timer = setInterval(check, 250); timer.unref(); check();
          try {
            const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(60_000)]);
            signal.throwIfAborted();
            const result = await untilAbort(dialog.showMessageBox(context.window, {
              type: 'warning', title: 'MindOS · 草稿恢复', message: matches ? '发现未保存的插件草稿' : '草稿对应的笔记或插件已发生变化',
              detail: `${latest.filePath}\n${new Date(latest.updatedAt).toLocaleString()}\n\n${matches
                ? '恢复只载入编辑器，不会自动写入知识库。保存时仍会检查版本。'
                : '为防止覆盖较新的内容，不直接恢复。请查看备份文件中的 content 字段，手动核对。'}\n\n共 ${records.length} 份备份，当前为最近一份；其余备份仍保留。`,
              buttons: matches ? ['取消', '恢复草稿', '查看备份文件'] : ['取消', '查看备份文件'],
              defaultId: 0, cancelId: 0, noLink: true, signal,
            }), signal);
            check(); lifetime.signal.throwIfAborted();
            if (result.response === (matches ? 2 : 1)) {
              const error = await shell.openPath(recoveryDirectory);
              if (error) throw new Error(`Cannot open recovery folder: ${error}`);
              return { opened: false };
            }
            if (!matches || result.response !== 1) return { opened: false };
            restored = latest;
          } finally { clearInterval(timer); lifetime.abort(); }
        }
        recovery = createRecoverableObsidianSession(approved, store, restored);
        pending.add(recovery);
        const editor = await createObsidianEditorWindow({ session: recovery.session, recovery, runtimeSource,
          preloadPath: join(artifactDirectory, 'preload.js') });
        if (editor.window.isDestroyed()) throw new Error('Plugin editor closed during startup.');
        const activeRecovery = recovery;
        editor.window.once('closed', () => { occupied = false; drain(activeRecovery); });
        opened = true;
        return { opened: true };
      } finally {
        if (!opened) {
          if (recovery) { recovery.session.close(); drain(recovery); } else approved?.close();
          occupied = false;
        }
      }
    },
  };
}
