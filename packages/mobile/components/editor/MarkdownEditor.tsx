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

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  TextInput,
  ScrollView,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import MarkdownToolbar from './MarkdownToolbar';
import { TOOLBAR_ACTIONS } from './markdown-actions';
import type { ToolbarAction, Selection } from './markdown-actions';
import { mindosClient } from '@/lib/api-client';
import { getMarkdownStyles } from '@/lib/markdown-styles';

const DRAFT_PREFIX = 'mindos_draft_';
const DRAFT_DEBOUNCE_MS = 3000;
const MAX_EDITABLE_BYTES = Platform.OS === 'android' ? 20 * 1024 : 100 * 1024;

interface MarkdownEditorProps {
  filePath: string;
  initialContent: string;
  initialMtime?: number;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function MarkdownEditor({
  filePath,
  initialContent,
  initialMtime,
  onSaved,
  onDirtyChange,
}: MarkdownEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [dirty, _setDirty] = useState(false);
  const setDirty = useCallback((val: boolean) => {
    _setDirty(val);
    onDirtyChange?.(val);
  }, [onDirtyChange]);
  const [lastMtime, setLastMtime] = useState(initialMtime);
  const [saveError, setSaveError] = useState('');

  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const selectionRef = useRef<Selection>({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hermes has no TextEncoder; use string.length as rough byte estimate
  const isLargeFile = content.length > MAX_EDITABLE_BYTES;

  // --- Draft auto-save ---

  const saveDraft = useCallback(async (text: string) => {
    try {
      await AsyncStorage.setItem(DRAFT_PREFIX + filePath, text);
    } catch { /* best-effort */ }
  }, [filePath]);

  useEffect(() => {
    if (!dirty) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => saveDraft(content), DRAFT_DEBOUNCE_MS);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [content, dirty, saveDraft]);

  // Load draft on mount
  useEffect(() => {
    (async () => {
      const draft = await AsyncStorage.getItem(DRAFT_PREFIX + filePath);
      if (draft && draft !== initialContent) {
        Alert.alert(
          'Unsaved Draft',
          'A local draft was found. Do you want to restore it?',
          [
            { text: 'Discard', style: 'destructive', onPress: () => AsyncStorage.removeItem(DRAFT_PREFIX + filePath) },
            { text: 'Restore', onPress: () => { setContent(draft); setDirty(true); } },
          ],
        );
      }
    })();
  }, [filePath, initialContent, setDirty]);

  // --- Toolbar actions ---

  const handleToolbarAction = useCallback((action: ToolbarAction) => {
    const actionFn = TOOLBAR_ACTIONS[action].apply;
    const result = actionFn(content, selectionRef.current);
    setContent(result.content);
    setDirty(true);
    // Update selection via controlled prop (setNativeProps doesn't work on Fabric)
    setSelection(result.selection);
    selectionRef.current = result.selection;
  }, [content]);

  // --- Save to server ---

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError('');

    try {
      const result = await mindosClient.saveFile(filePath, content, lastMtime);

      if (!result.ok && result.error === 'conflict') {
        Alert.alert(
          'Conflict Detected',
          'This file was modified on another device. What would you like to do?',
          [
            {
              text: 'Overwrite',
              style: 'destructive',
              onPress: async () => {
                // Force save without mtime check
                const forced = await mindosClient.saveFile(filePath, content);
                if (forced.ok) {
                  setLastMtime(forced.mtime);
                  setDirty(false);
                  await AsyncStorage.removeItem(DRAFT_PREFIX + filePath);
                  onSaved?.();
                }
              },
            },
            {
              text: 'Keep Both',
              onPress: async () => {
                const copyPath = filePath.replace(/\.md$/, `-${Date.now()}.md`);
                await mindosClient.saveFile(copyPath, content);
                Alert.alert('Saved', `Your version saved as ${copyPath}`);
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }

      if (result.ok) {
        setLastMtime(result.mtime);
        setDirty(false);
        await AsyncStorage.removeItem(DRAFT_PREFIX + filePath);
        onSaved?.();
      }
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [content, filePath, lastMtime, onSaved]);

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
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                <Text style={styles.saveBtnText}>Save</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {/* Large file warning */}
      {isLargeFile && mode === 'edit' && (
        <View style={styles.warningBar}>
          <Ionicons name="warning-outline" size={14} color="#eab308" />
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
            <Ionicons name="close" size={14} color="#fca5a5" />
          </Pressable>
        </View>
      ) : null}

      {/* Content area */}
      {mode === 'edit' ? (
        <TextInput
          ref={inputRef}
          style={styles.editor}
          value={content}
          onChangeText={(text) => { setContent(text); setDirty(true); }}
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
          placeholderTextColor="#78716c"
        />
      ) : (
        <ScrollView style={styles.preview} contentContainerStyle={styles.previewInner}>
          <Markdown style={getMarkdownStyles('document')}>{content}</Markdown>
        </ScrollView>
      )}

      {/* Toolbar (only in edit mode) */}
      {mode === 'edit' && (
        <MarkdownToolbar onAction={handleToolbarAction} disabled={saving} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#292524',
    borderRadius: 8,
    padding: 2,
  },
  modeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  modeBtnActive: {
    backgroundColor: '#44403c',
  },
  modeBtnText: { fontSize: 13, color: '#78716c', fontWeight: '500' },
  modeBtnTextActive: { color: '#fafaf9' },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#c8873a',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#c8873a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  warningBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
  },
  warningText: { fontSize: 12, color: '#eab308' },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  errorText: { fontSize: 12, color: '#fca5a5', flex: 1 },
  editor: {
    flex: 1,
    padding: 16,
    color: '#d6d3d1',
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'monospace',
  },
  preview: { flex: 1 },
  previewInner: { padding: 16, paddingBottom: 40 },
});

