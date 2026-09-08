import { app, dialog, type BrowserWindow } from 'electron';
import type { PluginSessionApproval, PluginApprovalDecision } from './obsidian-plugin-session';
import { managedObsidianBaseUrl, untilAbort } from './obsidian-response';

type OwnerOptions = { window: BrowserWindow; baseUrl: string; isCurrent: () => boolean };

/** Bind native consent to one live, local main document, not just a webContents id. */
export function bindObsidianWindowOwner({ window, baseUrl, isCurrent: current }: OwnerOptions) {
  const base = managedObsidianBaseUrl(baseUrl);
  const lifetime = new AbortController();
  const contents = window.webContents;
  const frame = contents.mainFrame;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pendingApproval = false;
  const dispose = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort(new Error('Plugin approval owner closed.'));
    clearInterval(timer);
    window.removeListener('closed', dispose);
    contents.removeListener('destroyed', dispose);
    contents.removeListener('render-process-gone', dispose);
    contents.removeListener('did-start-navigation', onNavigation);
  };
  const isCurrent = () => {
    if (lifetime.signal.aborted) return false;
    let valid = false;
    try {
      valid = !window.isDestroyed() && !contents.isDestroyed() && window.webContents === contents
        && contents.mainFrame === frame && new URL(contents.getURL()).origin === base.origin
        && new URL(frame.url).origin === base.origin && current() === true;
    } catch { /* Destroyed frames and failing mode checks revoke just like a close. */ }
    if (!valid) dispose();
    return valid;
  };
  const onNavigation = (details: { isMainFrame?: boolean }, _url?: string, _inPlace?: boolean, legacyMainFrame?: boolean) => {
    if ((details.isMainFrame ?? legacyMainFrame) === true) dispose();
  };
  if (!isCurrent()) throw new Error('Plugin approval requires the current local window.');
  window.on('closed', dispose);
  contents.on('destroyed', dispose);
  contents.on('render-process-gone', dispose);
  contents.on('did-start-navigation', onNavigation);
  // Mode changes may leave the owner visible. Revoke pending native consent even
  // when no renderer IPC or document request arrives to trigger another check.
  timer = setInterval(isCurrent, 250);
  timer.unref();
  return Object.freeze({
    signal: lifetime.signal, isCurrent, dispose,
    async approve(subject: PluginSessionApproval): Promise<PluginApprovalDecision> {
      if (!isCurrent()) throw new Error('Plugin approval authorization is no longer valid.');
      if (pendingApproval) throw new Error('A native plugin approval is already pending.');
      pendingApproval = true;
      try {
        const zh = app.getLocale().startsWith('zh');
        const offerVault = subject.optionalCapabilities?.includes('vault:read') === true;
        const result = await untilAbort(dialog.showMessageBox(window, {
          type: 'warning', title: zh ? 'Obsidian 插件授权' : 'Obsidian plugin approval',
          message: zh ? `允许 ${subject.pluginName} 处理这篇笔记？` : `Allow ${subject.pluginName} to work on this note?`,
          detail: [
            `${subject.pluginId} · ${subject.pluginVersion}`, subject.filePath,
            `${zh ? '知识库' : 'Vault'}: ${subject.vaultId}`, `SHA-256: ${subject.fingerprint}`,
            zh ? '默认仅批准读取和修改这篇笔记。不包括网络、Node.js 或系统权限。'
              : 'By default, approves reading and modifying this note only. No network, Node.js or system access.',
            ...(offerVault ? [zh ? '可选勾选：只读知识库其他可见文件（包括附件，不含隐藏目录）。每个文件最多 2 MiB，总量最多 64 MiB；超限会停止启动。写入仍只限这篇笔记。'
              : 'Optional: read other visible Vault files, including attachments but excluding hidden directories. Maximum 2 MiB per file and 64 MiB total; exceeding limits stops launch. Writes remain limited to this note.'] : []),
            zh ? '兼容功能仍在开发；此批准只对本次窗口会话和这份插件代码有效。'
              : 'Compatibility is still in development. Approval applies only to this window session and this exact plugin code.',
            zh ? '桌面编辑器会在应用私有目录保留明文草稿恢复副本。强制退出仍可能丢失尚未备份的修改，请及时保存。'
              : 'The desktop editor keeps plaintext recovery drafts in its private app directory. Forced exit may lose changes not yet backed up; save regularly.',
          ].join('\n\n'),
          buttons: zh ? ['取消', '允许本次会话'] : ['Cancel', 'Allow this session'],
          defaultId: 0, cancelId: 0, noLink: true, signal: lifetime.signal,
          ...(offerVault ? { checkboxChecked: false, checkboxLabel: zh ? '额外允许只读其他知识库文件' : 'Also allow read-only access to other Vault files' } : {}),
        }), lifetime.signal);
        if (!isCurrent()) throw new Error('Plugin approval authorization is no longer valid.');
        return result.response === 1 ? offerVault && result.checkboxChecked === true ? 'read-vault' : true : false;
      } finally { pendingApproval = false; }
    },
  });
}
