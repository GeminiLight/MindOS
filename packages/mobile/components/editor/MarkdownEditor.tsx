import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * MarkdownEditor — Plain text Markdown editor with toolbar and auto-save.
 *
 * Features:
 * - Edit / Preview mode toggle
 * - Markdown toolbar (heading, bold, italic, code, list, etc.)
 * - Auto-save draft to AsyncStorage every 3s
 * - Save to server with conflict detection (expectedMtime)
 * - Large file warning (>20KB on Android)
 */

import { mindosClient } from '@/lib/api-client';
import { getMarkdownStyles } from '@/lib/markdown-styles';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import MarkdownToolbar from './MarkdownToolbar';
import type { Selection, ToolbarAction } from './markdown-actions';
import { TOOLBAR_ACTIONS } from './markdown-actions';
import { createMarkdownDraftQueue } from './markdown-draft-queue';
import { buildConflictCopyPath, buildMarkdownDraftKey } from './markdown-editor-state';

const DRAFT_DEBOUNCE_MS = 3000;
const draftStorage = createMarkdownDraftQueue(AsyncStorage);
const MAX_EDITABLE_BYTES = Platform.OS === 'android' ? 20 * 1024 : 100 * 1024;

export async function clearMarkdownDraft(filePath: string, key?: string): Promise<void> {
  if (key) { await draftStorage.removeItem(key); return; }
  const server = mindosClient.baseUrl;
  const info = { rootId: mindosClient.rootId };
  if (info?.rootId && server === mindosClient.baseUrl) {
    await draftStorage.removeItem(buildMarkdownDraftKey(server, info.rootId, filePath));
  }
}

export interface MarkdownEditorHandle { discard: () => Promise<void> }

interface MarkdownEditorProps {
  ref?: Ref<MarkdownEditorHandle>;
  initialRevision?: string;
  vaultId?: string;
  filePath: string;
  initialContent: string;
  initialMtime?: number;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function MarkdownEditor({
  ref,
  initialRevision,
  vaultId,
  filePath,
  initialContent,
  initialMtime,
  onSaved,
  onDirtyChange,
}: MarkdownEditorProps) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [dirty, _setDirty] = useState(false);
  const setDirty = useCallback((val: boolean) => {
    dirtyRef.current = val;
    _setDirty(val);
    onDirtyChange?.(val);
  }, [onDirtyChange]);
  const [lastRevision, setLastRevision] = useState(initialRevision);
  const editorRootId = useRef(mindosClient.rootId || undefined).current;
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [lastMtime, setLastMtime] = useState(initialMtime);
  const [saveError, setSaveError] = useState('');
  const [draftKey, setDraftKey] = useState<string>();

  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const selectionRef = useRef<Selection>({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Hermes has no TextEncoder; use string.length as rough byte estimate
  const isLargeFile = content.length > MAX_EDITABLE_BYTES;

  // --- Draft auto-save ---

  const saveDraft = useCallback(async (text: string) => {
    if (!draftKey) return;
    try {
      await draftStorage.setItem(draftKey, text);
    } catch { if (mounted.current) setSaveError('Could not save the local draft. Keep this editor open and retry Save.'); }
  }, [draftKey]);

  const flushDraftNow = useCallback(() => {
    if (!dirtyRef.current) return;
    void saveDraft(contentRef.current);
  }, [saveDraft]);

  useEffect(() => {
    if (!dirty) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => saveDraft(content), DRAFT_DEBOUNCE_MS);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [content, dirty, saveDraft]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushDraftNow();
    });
    return () => {
      subscription.remove();
      flushDraftNow();
    };
  }, [flushDraftNow]);

  useImperativeHandle(ref, () => ({
    discard: async () => {
      dirtyRef.current = false;
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (draftKey) await clearMarkdownDraft(filePath, draftKey);
      setDirty(false);
    }
  }), [draftKey, filePath, setDirty]);

  // Load draft on mount
  useEffect(() => {
    let canceled = false;
    const server = mindosClient.baseUrl;
    setDraftKey(undefined);
    (async () => {
      const info = { rootId: mindosClient.rootId };
      if (canceled || server !== mindosClient.baseUrl) return;
      if (!info?.rootId) {
        setSaveError('Local draft recovery requires a server with knowledge-root identification. Use Save to persist your changes.');
        return;
      }
      const key = buildMarkdownDraftKey(server, info.rootId, filePath);
      setDraftKey(key);
      const draft = await AsyncStorage.getItem(key);
      if (canceled || server !== mindosClient.baseUrl || dirtyRef.current) return;
      if (draft && draft !== initialContent) {
        Alert.alert(
          'Unsaved Draft',
          'A local draft was found. Do you want to restore it?',
          [
            { text: 'Discard', style: 'destructive', onPress: () => { void clearMarkdownDraft(filePath, key); } },
            {
              text: 'Restore', onPress: () => {
                if (canceled || server !== mindosClient.baseUrl || dirtyRef.current) return;
                contentRef.current = draft; setContent(draft); setDirty(true);
              }
            },
          ],
        );
      }
    })().catch(() => {
      if (!canceled) setSaveError('Could not read the local draft. Use Save to persist your changes.');
    });
    return () => { canceled = true; };
  }, [filePath, initialContent, setDirty]);

  // --- Toolbar actions ---

  const handleToolbarAction = useCallback((action: ToolbarAction) => {
    const actionFn = TOOLBAR_ACTIONS[action].apply;
    const result = actionFn(content, selectionRef.current);
    contentRef.current = result.content;
    setContent(result.content);
    setDirty(true);
    // Update selection via controlled prop (setNativeProps doesn't work on Fabric)
    setSelection(result.selection);
    selectionRef.current = result.selection;
  }, [content, setDirty]);

  // --- Save to server ---

  const completeSuccessfulSave = useCallback(async (savedContent: string, nextMtime?: number, revision?: string) => {
    if (!mounted.current) return;
    setLastMtime(nextMtime);
    setLastRevision(revision);
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    // A successful request only covers its snapshot, not typing that happened while it was in flight.
    if (contentRef.current !== savedContent) {
      await saveDraft(contentRef.current);
      return;
    }
    if (draftKey) await clearMarkdownDraft(filePath, draftKey);
    // Storage is asynchronous too: do not close over edits made during cleanup.
    if (contentRef.current !== savedContent) { await saveDraft(contentRef.current); return; }
    dirtyRef.current = false;
    setDirty(false);
    onSaved?.();
  }, [filePath, draftKey, onSaved, setDirty, saveDraft]);

  const runConflictSaveAction = useCallback(async (
    savedContent: string,
    action: () => Promise<{ ok: boolean; mtime?: number; revision?: string; error?: string }>,
  ) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const result = await action();
      if (result.ok) {
        await completeSuccessfulSave(savedContent, result.mtime, result.revision);
        return;
      }
      setSaveError(result.error || 'Save failed');
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [completeSuccessfulSave]);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');

    const savedContent = contentRef.current;
    try {
      const result = await mindosClient.saveFile(filePath, savedContent, lastMtime, { expectedRevision: lastRevision, expectedVaultId: vaultId });

      if (!result.ok && result.error === 'conflict') {
        Alert.alert(
          'Conflict Detected',
          'This file was modified on another device. What would you like to do?',
          [
            {
              text: 'Overwrite',
              style: 'destructive',
              onPress: () => {
                void runConflictSaveAction(savedContent, () => mindosClient.saveFile(filePath, savedContent, undefined, { expectedVaultId: vaultId }));
              },
            },
            {
              text: 'Keep Both',
              onPress: () => {
                const copyPath = buildConflictCopyPath(filePath);
                void runConflictSaveAction(savedContent, async () => {
                  const saved = await mindosClient.createFile(copyPath, savedContent, editorRootId);
                  if (saved.ok) {
                    Alert.alert('Saved', `Your version saved as ${copyPath}`);
                  }
                  return saved.ok ? { ...saved, mtime: lastMtime, revision: lastRevision } : saved;
                });
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }

      if (result.ok) {
        await completeSuccessfulSave(savedContent, result.mtime, result.revision);
      } else {
        setSaveError(result.error || 'Save failed');
      }
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [completeSuccessfulSave, filePath, lastMtime, lastRevision, vaultId, runConflictSaveAction]);

  // --- Render ---

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.header}>
        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeBtn, mode === 'edit' && styles.modeBtnActive]}
            onPress={() => setMode('edit')}
          >
            <Text style={[styles.modeBtnText, mode === 'edit' && styles.modeBtnTextActive]}>
              Edit
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeBtn, mode === 'preview' && styles.modeBtnActive]}
            onPress={() => setMode('preview')}
          >
            <Text style={[styles.modeBtnText, mode === 'preview' && styles.modeBtnTextActive]}>
              Preview
            </Text>
          </Pressable>
        </View>

        <View style={styles.headerRight}>
          {dirty && <View style={styles.dirtyDot} />}
          <Pressable
            style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={16} color={colors.white} />
                <Text style={styles.saveBtnText}>Save</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {/* Large file warning */}
      {isLargeFile && mode === 'edit' && (
        <View style={styles.warningBar}>
          <Ionicons name="warning-outline" size={14} color={colors.warning} />
          <Text style={styles.warningText}>
            Large file — editing may be slow on this device
          </Text>
        </View>
      )}

      {/* Save error */}
      {saveError ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{saveError}</Text>
          <Pressable onPress={() => setSaveError('')}>
            <Ionicons name="close" size={14} color={colors.errorText} />
          </Pressable>
        </View>
      ) : null}

      {/* Content area */}
      {mode === 'edit' ? (
        <TextInput
          ref={inputRef}
          style={styles.editor}
          value={content}
          onChangeText={(text) => { contentRef.current = text; setContent(text); setDirty(true); }}
          accessibilityLabel="Markdown content"
          selection={selection}
          onSelectionChange={(e) => {
            const sel = e.nativeEvent.selection;
            selectionRef.current = sel;
            setSelection(sel);
          }}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          scrollEnabled
          textAlignVertical="top"
          placeholder="Start writing..."
          placeholderTextColor={colors.textSubtle}
        />
      ) : (
        <ScrollView style={styles.preview} contentContainerStyle={styles.previewInner}>
          <Markdown style={getMarkdownStyles('document', colors)}>{content}</Markdown>
        </ScrollView>
      )}

      {/* Toolbar (only in edit mode) */}
      {mode === 'edit' && (
        <MarkdownToolbar onAction={handleToolbarAction} disabled={saving} />
      )}
    </View>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.surface,
    },
    modeToggle: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 2,
    },
    modeBtn: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
    },
    modeBtnActive: {
      backgroundColor: colors.border,
    },
    modeBtnText: { fontSize: 13, color: colors.textSubtle, fontWeight: '500' },
    modeBtnTextActive: { color: colors.text },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dirtyDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.amberAction,
    },
    saveBtn: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.amberAction,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    saveBtnDisabled: { opacity: 0.4 },
    saveBtnText: { fontSize: 13, color: colors.white, fontWeight: '600' },
    warningBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.warningSoft,
    },
    warningText: { fontSize: 12, color: colors.warning },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.errorSoft,
    },
    errorText: { fontSize: 12, color: colors.errorText, flex: 1 },
    editor: {
      flex: 1,
      padding: 16,
      color: colors.text,
      fontSize: 14,
      lineHeight: 22,
      fontFamily: 'monospace',
    },
    preview: { flex: 1 },
    previewInner: { padding: 16, paddingBottom: 40 },
  });
  return { styles };
}
