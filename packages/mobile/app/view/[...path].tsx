import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * File/directory view — renders Markdown preview, directory listing, or Markdown editor.
 */
import CSVTable from '@/components/CSVTable';
import MarkdownEditor, { type MarkdownEditorHandle } from '@/components/editor/MarkdownEditor';
import { InlineBanner } from '@/components/ui/MobileScaffold';
import { mindosClient } from '@/lib/api-client';
import { findNode, sortFileNodes } from '@/lib/file-tree';
import { getMarkdownStyles } from '@/lib/markdown-styles';
import { getFileNodeIcon } from '@/lib/mobile-icons';
import { viewFileHref } from '@/lib/mobile-navigation';
import type { FileNode } from '@/lib/types';
import { resolveReaderErrorMessage } from '@/lib/view-target-state';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useHeaderHeight, usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';

export default function ViewScreen() {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const { path: pathSegments } = useLocalSearchParams<{ path: string[] }>();
  const filePath = Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments ?? '';
  const fileName = filePath.split('/').pop() || filePath;
  const isMarkdown = fileName.endsWith('.md');
  const router = useRouter();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [fileVersion, setFileVersion] = useState<{ revision?: string; vaultId?: string }>({});

  const [cached, setCached] = useState(false);
  const [content, setContent] = useState('');
  const [mtime, setMtime] = useState<number | undefined>();
  const [children, setChildren] = useState<FileNode[]>([]);
  const [isDir, setIsDir] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  const setEditorDirty = useCallback((nextDirty: boolean) => {
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
  }, []);

  const discardEditorChanges = useCallback(async () => {
    try {
      await editorRef.current?.discard();
      dirtyRef.current = false;
      setDirty(false);
      setEditing(false);
      return true;
    } catch { Alert.alert('Draft could not be cleared', 'Please retry before leaving the editor.'); return false; }
  }, []);

  const handleExitEditor = useCallback(() => {
    if (dirtyRef.current) {
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved changes. Discard them?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => { void discardEditorChanges(); } },
        ],
      );
    } else {
      setEditing(false);
    }
  }, [discardEditorChanges]);

  usePreventRemove(editing && dirty, ({ data }) => {
    Alert.alert('Unsaved Changes', 'Discard your local edits and leave this file?', [
      { text: 'Keep Editing', style: 'cancel' },
      {
        text: 'Discard', style: 'destructive', onPress: () => {
          void discardEditorChanges().then(discarded => { if (discarded) navigation.dispatch(data.action); });
        }
      },
    ]);
  });

  const requestIdRef = useRef(0);

  const loadContent = useCallback(() => {
    const currentId = ++requestIdRef.current;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await mindosClient.getReadableFile(filePath, controller.signal);
        if (currentId !== requestIdRef.current) return;
        setCached(data.cached === true);
        setContent(data.content);
        setMtime(data.mtime);
        setFileVersion({ revision: data.revision, vaultId: data.vaultId });
        setIsDir(false);
      } catch (readError) {
        if (currentId !== requestIdRef.current) return;
        try {
          const tree = await mindosClient.getFileTree();
          if (currentId !== requestIdRef.current) return;
          const node = findNode(tree, filePath);
          if (node?.children) {
            // Sort: directories first, then alphabetically
            setChildren(sortFileNodes(node.children));
            setIsDir(true);
          } else {
            setError(resolveReaderErrorMessage(readError));
          }
        } catch {
          if (currentId !== requestIdRef.current) return;
          setError(resolveReaderErrorMessage(readError));
        }
      } finally {
        if (currentId === requestIdRef.current) setLoading(false);
      }
    })();

    return () => { requestIdRef.current++; controller.abort(); };
  }, [filePath]);

  useEffect(() => {
    const cleanup = loadContent();
    return cleanup;
  }, [loadContent]);

  // --- Loading ---
  if (loading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: fileName }} />
        <ActivityIndicator color={colors.amber} style={{ marginTop: 40 }} />
      </View>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: fileName }} />
        <View style={styles.errorCenter}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textSubtle} />
          <Text style={styles.errorText}>{error}</Text>
          <View style={styles.errorActions}>
            <Pressable style={[styles.retryBtn, styles.retryBtnPrimary]} onPress={loadContent}>
              <Text style={styles.retryTextPrimary}>Retry</Text>
            </Pressable>
            <Pressable style={styles.retryBtn} onPress={() => router.back()}>
              <Text style={styles.retryText}>Go Back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // --- Directory listing ---
  if (isDir) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: fileName }} />
        <FlatList
          data={children}
          keyExtractor={(item) => item.path}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(viewFileHref(item.path))}
            >
              <Ionicons
                name={getFileNodeIcon(item)}
                size={20}
                color={item.isSpace ? colors.amber : colors.textMuted}
              />
              <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
              {item.type === 'directory' && (
                <Ionicons name="chevron-forward" size={16} color={colors.border} />
              )}
            </Pressable>
          )}
        />
      </View>
    );
  }

  // --- Markdown editor mode ---
  if (editing && isMarkdown) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen
          options={{
            title: dirty ? `${fileName} *` : fileName,
            headerRight: () => null,
            headerLeft: () => (
              <Pressable accessibilityRole="button" accessibilityLabel="Close editor" onPress={handleExitEditor} style={styles.headerBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            ),
          }}
        />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
          <MarkdownEditor
            ref={editorRef}
            initialRevision={fileVersion.revision}
            vaultId={fileVersion.vaultId}
            filePath={filePath}
            initialContent={content}
            initialMtime={mtime}
            onDirtyChange={setEditorDirty}
            onSaved={() => {
              setEditorDirty(false);
              setEditing(false);
              loadContent();
            }}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // --- Markdown preview (default) ---
  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: fileName,
          headerLeft: undefined,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Share note" onPress={() => Share.share({ message: content, title: fileName })} style={styles.headerBtn}>
                <Ionicons name="share-outline" size={20} color={colors.textMuted} />
              </Pressable>
              {isMarkdown && !cached && (
                <Pressable accessibilityRole="button" accessibilityLabel="Edit note" onPress={() => setEditing(true)} style={styles.headerBtn}>
                  <Ionicons name="create-outline" size={22} color={colors.amber} />
                </Pressable>
              )}
            </View>
          ),
        }}
      />
      {cached ? <InlineBanner tone="warning" title="Saved on this device" message="You are reading a cached copy. Reconnect to edit the latest version." actionLabel="Retry" onAction={loadContent} /> : null}
      {fileName.endsWith('.csv') || fileName.endsWith('.tsv') ? (
        <CSVTable content={content} delimiter={fileName.endsWith('.tsv') ? '\t' : ','} />
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          <Markdown style={getMarkdownStyles('document', colors)}>{content}</Markdown>
        </ScrollView>
      )}
    </View>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1 },
    contentInner: { padding: 16, paddingBottom: 40 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.surface,
    },
    rowName: { flex: 1, fontSize: 15, color: colors.text },
    errorCenter: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 12,
      padding: 32,
    },
    errorText: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
    errorActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    retryBtn: {
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 8,
    },
    retryBtnPrimary: {
      backgroundColor: colors.amberAction,
    },
    retryText: { color: colors.text, fontWeight: '500' },
    retryTextPrimary: { color: colors.white, fontWeight: '600' },
    headerBtn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
  });
  return { styles };
}
