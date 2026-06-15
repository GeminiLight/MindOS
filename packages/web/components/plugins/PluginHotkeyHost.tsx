'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  choosePluginMenuItem,
  choosePluginModalSuggestion,
  executePluginCommandSurface,
  fetchPluginCommandSurfaces,
  firstPluginActionMenuSnapshot,
  firstPluginActionModalSnapshot,
  firstPluginActionTargetPath,
  OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT,
  pluginCommandHotkeyMatchesEvent,
  pluginEditorCommandContextForPathname,
  readObsidianPluginHotkeysEnabled,
  toastPluginActionNotices,
  type PluginActionResult,
  type PluginMenuSnapshot,
  type PluginModalSnapshot,
  type PluginModalSuggestionChoice,
} from '@/lib/plugins/client';
import { PLUGINS_CHANGED_EVENT } from '@/lib/plugins/events';
import type { PluginSurface } from '@/lib/plugins/surfaces';
import { encodePath } from '@/lib/utils';
import { openTab } from '@/lib/workspace-tabs';
import { toast } from '@/lib/toast';
import { notifyFilesChanged } from '@/lib/files-changed';
import PluginActionModalDialog from './PluginActionModalDialog';
import PluginActionMenuDialog from './PluginActionMenuDialog';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function canRunFromEditableTarget(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

export default function PluginHotkeyHost() {
  const [enabled, setEnabled] = useState(false);
  const [surfaces, setSurfaces] = useState<PluginSurface[]>([]);
  const [pluginModal, setPluginModal] = useState<PluginModalSnapshot | null>(null);
  const [pluginMenu, setPluginMenu] = useState<PluginMenuSnapshot | null>(null);
  const [choosingSuggestionIndex, setChoosingSuggestionIndex] = useState<number | null>(null);
  const [modalChoiceError, setModalChoiceError] = useState<string | null>(null);
  const [choosingMenuItemIndex, setChoosingMenuItemIndex] = useState<number | null>(null);
  const [menuChoiceError, setMenuChoiceError] = useState<string | null>(null);
  const router = useRouter();
  const smoothPush = useSmoothRouterPush();
  const pathname = usePathname();
  const pluginEditorContext = useMemo(() => pluginEditorCommandContextForPathname(pathname), [pathname]);

  const refreshSurfaces = useCallback((options: { bypassCache?: boolean } = {}) => {
    if (!readObsidianPluginHotkeysEnabled()) {
      setSurfaces([]);
      return;
    }

    void fetchPluginCommandSurfaces(pluginEditorContext, { bypassCache: options.bypassCache })
      .then(setSurfaces)
      .catch(() => setSurfaces([]));
  }, [pluginEditorContext]);

  const refreshEnabled = useCallback(() => {
    const nextEnabled = readObsidianPluginHotkeysEnabled();
    setEnabled(nextEnabled);
    if (nextEnabled) {
      refreshSurfaces({ bypassCache: true });
    } else {
      setSurfaces([]);
    }
  }, [refreshSurfaces]);

  const applyPluginActionResult = useCallback((result: PluginActionResult, fallbackTitle = 'plugin command') => {
    const showedNotice = toastPluginActionNotices(result);
    const targetPath = firstPluginActionTargetPath(result);
    if (targetPath) {
      openTab('doc', targetPath, targetPath.split('/').pop() || targetPath);
      smoothPush(`/view/${encodePath(targetPath)}`);
      toast.success(`Opened ${targetPath}`);
      setPluginModal(null);
      setPluginMenu(null);
      return;
    }

    if (result.editorUpdates?.some((update) => update.changed)) {
      notifyFilesChanged(
        result.editorUpdates.flatMap((update) => update.changed && update.sourcePath ? [update.sourcePath] : []),
      );
      router.refresh();
      toast.success(`Updated ${result.editorUpdates[0]?.sourcePath ?? 'current note'}`);
      setPluginModal(null);
      setPluginMenu(null);
      return;
    }

    const modal = firstPluginActionModalSnapshot(result);
    if (modal) {
      setPluginModal(modal);
      setPluginMenu(null);
      return;
    }

    const menu = firstPluginActionMenuSnapshot(result);
    if (menu) {
      setPluginMenu(menu);
      setPluginModal(null);
      return;
    }

    setPluginModal(null);
    setPluginMenu(null);
    if (!showedNotice) {
      toast.success(`Ran ${fallbackTitle}`);
    }
  }, [router, smoothPush]);

  useEffect(() => {
    refreshEnabled();
    window.addEventListener(OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT, refreshEnabled);
    window.addEventListener('storage', refreshEnabled);
    return () => {
      window.removeEventListener(OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT, refreshEnabled);
      window.removeEventListener('storage', refreshEnabled);
    };
  }, [refreshEnabled]);

  useEffect(() => {
    refreshSurfaces();
    if (!enabled) return;
    const onPluginChange = () => refreshSurfaces({ bypassCache: true });
    window.addEventListener(PLUGINS_CHANGED_EVENT, onPluginChange);
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, onPluginChange);
  }, [enabled, refreshSurfaces]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableTarget(event.target) && !canRunFromEditableTarget(event)) return;

      const surface = surfaces.find((item) => pluginCommandHotkeyMatchesEvent(item, event));
      if (!surface) return;

      event.preventDefault();
      void executePluginCommandSurface(surface, pluginEditorContext)
        .then((result) => applyPluginActionResult(result, surface.title))
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : 'Failed to run plugin hotkey');
        });
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [applyPluginActionResult, enabled, pluginEditorContext, surfaces]);

  const chooseModalSuggestion = async (modal: PluginModalSnapshot, suggestion: PluginModalSuggestionChoice) => {
    setChoosingSuggestionIndex(suggestion.index);
    setModalChoiceError(null);
    try {
      if (!modal.interactionId) {
        throw new Error('Plugin modal interaction expired. Run the command again.');
      }
      const result = await choosePluginModalSuggestion(modal.id, suggestion.index, modal.interactionId);
      applyPluginActionResult(result);
      refreshSurfaces();
    } catch (error) {
      setModalChoiceError(error instanceof Error ? error.message : 'Failed to choose plugin suggestion');
    } finally {
      setChoosingSuggestionIndex(null);
    }
  };

  const chooseMenuItem = async (menu: PluginMenuSnapshot, item: PluginMenuSnapshot['items'][number]) => {
    setChoosingMenuItemIndex(item.index);
    setMenuChoiceError(null);
    try {
      if (!menu.interactionId) {
        throw new Error('Plugin menu interaction expired. Run the command again.');
      }
      const result = await choosePluginMenuItem(menu.id, item.index, menu.interactionId);
      applyPluginActionResult(result);
      refreshSurfaces();
    } catch (error) {
      setMenuChoiceError(error instanceof Error ? error.message : 'Failed to choose plugin menu item');
    } finally {
      setChoosingMenuItemIndex(null);
    }
  };

  return (
    <>
      <PluginActionModalDialog
        modal={pluginModal}
        onClose={() => setPluginModal(null)}
        onChooseSuggestion={chooseModalSuggestion}
        choosingSuggestionIndex={choosingSuggestionIndex}
        choiceError={modalChoiceError}
      />
      <PluginActionMenuDialog
        menu={pluginMenu}
        onClose={() => setPluginMenu(null)}
        onChooseItem={chooseMenuItem}
        choosingItemIndex={choosingMenuItemIndex}
        choiceError={menuChoiceError}
      />
    </>
  );
}
