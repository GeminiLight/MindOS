/**
 * Files tab — file tree browser with create file support.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { mindosClient } from '@/lib/api-client';
import type { FileNode } from '@/lib/types';

export default function FilesScreen() {
  const router = useRouter();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const files = await mindosClient.getFileTree();
      setTree(files);
    } catch {
      // handled by connection store
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleCreateFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) return;

    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    setCreating(true);
    try {
      await mindosClient.saveFile(fileName, `# ${name.replace(/\.md$/, '')}\n\n`);
      setShowNewFile(false);
      setNewFileName('');
      await load();
      // Navigate to the new file
      router.push(`/view/${fileName}` as any);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setCreating(false);
    }
  }, [newFileName, load, router]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#c8873a" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  function iconForNode(node: FileNode) {
    if (node.type === 'directory') {
      return node.isSpace ? 'layers-outline' : 'folder-outline';
    }
    if (node.extension === '.csv') return 'grid-outline';
    return 'document-text-outline';
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/* New file input */}
      {showNewFile && (
        <View style={styles.newFileBar}>
          <TextInput
            style={styles.newFileInput}
            value={newFileName}
            onChangeText={setNewFileName}
            placeholder="File name..."
            placeholderTextColor="#78716c"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleCreateFile}
            editable={!creating}
          />
          <Pressable
            style={[styles.newFileBtn, (!newFileName.trim() || creating) && styles.newFileBtnDisabled]}
            onPress={handleCreateFile}
            disabled={!newFileName.trim() || creating}
          >
            {creating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="checkmark" size={18} color="#fff" />
            )}
          </Pressable>
          <Pressable
            style={styles.newFileCancelBtn}
            onPress={() => { setShowNewFile(false); setNewFileName(''); }}
          >
            <Ionicons name="close" size={18} color="#78716c" />
          </Pressable>
        </View>
      )}

      <FlatList
        data={tree}
        keyExtractor={(item) => item.path}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c8873a" />
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(`/view/${item.path}` as any)}
          >
            <Ionicons
              name={iconForNode(item) as any}
              size={20}
              color={item.isSpace ? '#c8873a' : '#a8a29e'}
            />
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            {item.type === 'directory' && (
              <Ionicons name="chevron-forward" size={16} color="#44403c" />
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color="#44403c" />
            <Text style={styles.emptyText}>No files yet</Text>
            <Pressable
              style={styles.createFirstBtn}
              onPress={() => setShowNewFile(true)}
            >
              <Text style={styles.createFirstText}>Create your first note</Text>
            </Pressable>
          </View>
        }
      />

      {/* FAB: New file */}
      {!showNewFile && (
        <Pressable style={styles.fab} onPress={() => setShowNewFile(true)}>
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  newFileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#44403c',
    backgroundColor: '#292524',
  },
  newFileInput: {
    flex: 1,
    backgroundColor: '#1a1917',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fafaf9',
    fontSize: 14,
  },
  newFileBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#c8873a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  newFileBtnDisabled: { opacity: 0.4 },
  newFileCancelBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  name: { flex: 1, fontSize: 15, color: '#fafaf9' },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyText: { fontSize: 15, color: '#78716c' },
  createFirstBtn: {
    backgroundColor: '#c8873a',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  createFirstText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#c8873a',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
