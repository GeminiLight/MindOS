/**
 * File/directory view — renders Markdown preview, directory listing, or Markdown editor.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  Alert,
  Share,
  ActivityIndicator,
  BackHandler,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { mindosClient } from '@/lib/api-client';
import { findNode, sortFileNodes } from '@/lib/file-tree';
import { getMarkdownStyles } from '@/lib/markdown-styles';
import { getFileNodeIcon } from '@/lib/mobile-icons';
import { viewFileHref } from '@/lib/mobile-navigation';
import { resolveReaderErrorMessage } from '@/lib/view-target-state';
import MarkdownEditor, { clearMarkdownDraft } from '@/components/editor/MarkdownEditor';
import CSVTable from '@/components/CSVTable';
import type { FileNode } from '@/lib/types';

export default function ViewScreen() {
  const { path: pathSegments } = useLocalSearchParams<{ path: string[] }>();
  const filePath = Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments ?? '';
  const fileName = filePath.split('/').pop() || filePath;
  const isMarkdown = fileName.endsWith('.md');
  const router = useRouter();
  const navigation = useNavigation();

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
    dirtyRef.current = false;
    setDirty(false);
    await clearMarkdownDraft(filePath).catch(() => {});
    setEditing(false);
  }, [filePath]);

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

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!editing || !dirtyRef.current) return;
      event.preventDefault();
      Alert.alert(
        'Unsaved Changes',
        'Discard your local edits and leave this file?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              void clearMarkdownDraft(filePath).finally(() => {
                dirtyRef.current = false;
                setDirty(false);
                setEditing(false);
                navigation.dispatch(event.data.action);
              });
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [editing, filePath, navigation]);

  useEffect(() => {
    if (!editing) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirtyRef.current) return false;
      Alert.alert(
        'Unsaved Changes',
        'Discard your local edits and leave this file?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              void clearMarkdownDraft(filePath).finally(() => {
                dirtyRef.current = false;
                setDirty(false);
                setEditing(false);
                router.back();
              });
            },
          },
        ],
      );
      return true;
    });
    return () => subscription.remove();
  }, [editing, filePath, router]);

  const requestIdRef = useRef(0);

  const loadContent = useCallback(() => {
    const currentId = ++requestIdRef.current;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await mindosClient.getFileContent(filePath, controller.signal);
        if (currentId !== requestIdRef.current) return;
        setContent(data.content);
        setMtime(data.mtime);
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

    return () => controller.abort();
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
        <ActivityIndicator color="#c8873a" style={{ marginTop: 40 }} />
      </View>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: fileName }} />
        <View style={styles.errorCenter}>
          <Ionicons name="alert-circle-outline" size={48} color="#78716c" />
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
                color={item.isSpace ? '#c8873a' : '#a8a29e'}
              />
              <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
              {item.type === 'directory' && (
                <Ionicons name="chevron-forward" size={16} color="#44403c" />
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
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: dirty ? `${fileName} *` : fileName,
            headerLeft: () => (
              <Pressable onPress={handleExitEditor} style={styles.headerBtn}>
                <Ionicons name="close" size={22} color="#fafaf9" />
              </Pressable>
            ),
          }}
        />
        <MarkdownEditor
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
      </View>
    );
  }

  // --- Markdown preview (default) ---
  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: fileName,
          headerRight: () => (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => Share.share({ message: content, title: fileName })} style={styles.headerBtn}>
                    <Ionicons name="share-outline" size={20} color="#a8a29e" />
                  </Pressable>
                  {isMarkdown && (
                    <Pressable onPress={() => setEditing(true)} style={styles.headerBtn}>
                      <Ionicons name="create-outline" size={22} color="#c8873a" />
                    </Pressable>
                  )}
                </View>
              ),
        }}
      />
      {fileName.endsWith('.csv') || fileName.endsWith('.tsv') ? (
        <CSVTable content={content} delimiter={fileName.endsWith('.tsv') ? '\t' : ','} />
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          <Markdown style={getMarkdownStyles('document')}>{content}</Markdown>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  rowName: { flex: 1, fontSize: 15, color: '#fafaf9' },
  errorCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 32,
  },
  errorText: { fontSize: 15, color: '#a8a29e', textAlign: 'center' },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  retryBtn: {
    backgroundColor: '#292524',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnPrimary: {
    backgroundColor: '#c8873a',
  },
  retryText: { color: '#fafaf9', fontWeight: '500' },
  retryTextPrimary: { color: '#fff', fontWeight: '600' },
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
