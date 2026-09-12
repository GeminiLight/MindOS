import type { BrowserWindow } from 'electron';
import { prepareObsidianPluginSession, type PluginSessionOptions } from './obsidian-plugin-session';
import { bindObsidianWindowOwner } from './obsidian-window-owner';

type NativeSessionOptions = Omit<PluginSessionOptions, 'signal' | 'approve'> & { window: BrowserWindow };

/** Native consent + verified package/document transport. No plugin renderer is created here. */
export async function prepareNativeObsidianPluginSession(options: NativeSessionOptions) {
  options = { ...options };
  const owner = bindObsidianWindowOwner(options);
  try {
    const session = await prepareObsidianPluginSession({
      ...options, signal: owner.signal, isCurrent: owner.isCurrent, approve: owner.approve,
    });
    if (!session) { owner.dispose(); return null; }
    return Object.freeze({
      binding: session.binding, package: session.package, vault: session.vault,
      async readVault() {
        try { return await session.readVault(); }
        finally { if (session.snapshot.status === 'closed') owner.dispose(); }
      },
      get snapshot() { return session.snapshot; },
      setDraft: session.setDraft,
      readPluginData: session.readPluginData,
      savePluginData: session.savePluginData,
      async save() {
        try { await session.save(); }
        finally { if (session.snapshot.status === 'closed') owner.dispose(); }
      },
      close() { session.close(); owner.dispose(); },
    });
  } catch (error) { owner.dispose(); throw error; }
}
