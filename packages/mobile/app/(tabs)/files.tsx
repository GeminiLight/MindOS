/**
 * Files tab — file tree browser with folder drill-down navigation.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
  BackHandler,
  StyleSheet,
} from 'react-native';
import { ActionSheetIOS, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { mindosClient } from '@/lib/api-client';
import TextInputModal from '@/components/TextInputModal';
import FilesErrorBanner from '@/components/files/FilesErrorBanner';
import Breadcrumb from '@/components/Breadcrumb';
import { getFilesErrorMessage, getFilesTabViewState, getRenameInputDefaultValue } from '@/lib/files-tab-state';
import { getChildrenAtPath, getParentPath, sortFileNodes } from '@/lib/file-tree';
import type { FileNode } from '@/lib/types';

export default function FilesScreen() {
  const router = useRouter();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [creating, setCreating] = useState(false);

  // Android rename modal state
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);

  const load = useCallback(async () => {
    try {
      const files = await mindosClient.getFileTree();
      setTree(files);
      setError('');
    } catch (e) {
      setError(getFilesErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Android back button: go to parent folder or let default behavior
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (currentPath) {
        setCurrentPath(getParentPath(currentPath));
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [currentPath]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Compute visible children for the current directory
  const currentChildren = useMemo(() => {
    const children = getChildrenAtPath(tree, currentPath);
    return children ? sortFileNodes(children) : [];
  }, [tree, currentPath]);

  const viewState = getFilesTabViewState(currentChildren, error);

  const handleCreateFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) return;

    const baseName = name.endsWith('.md') ? name : `${name}.md`;
    const filePath = currentPath ? `${currentPath}/${baseName}` : baseName;
    setCreating(true);
    try {
      const exists = await mindosClient.fileExists(filePath);
      if (exists) {
        Alert.alert(
          'File Exists',
          `"${baseName}" already exists. Open it instead?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open',
              onPress: () => {
                setShowNewFile(false);
                setNewFileName('');
                router.push(`/view/${filePath}` as any);
              },
            },
          ],
        );
        return;
      }
      await mindosClient.saveFile(filePath, `# ${name.replace(/\.md$/, '')}\n\n`);
      setShowNewFile(false);
      setNewFileName('');
      await load();
      router.push(`/view/${filePath}` as any);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setCreating(false);
    }
  }, [newFileName, currentPath, load, router]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#c8873a" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  const handleLongPress = (item: FileNode) => {
    const isFile = item.type === 'file';
    const options = isFile
      ? ['Rename', 'Delete', 'View Path', 'Cancel']
      : ['View Path', 'Cancel'];
    const destructiveIndex = isFile ? 1 : -1;
    const cancelIndex = options.length - 1;

    const handleAction = (index: number) => {
      if (!isFile) {
        if (index === 0) Alert.alert(item.name, item.path);
        return;
      }
      switch (index) {
        case 0: // Rename
          if (Platform.OS === 'ios') {
            Alert.prompt(
              'Rename File',
              `Enter new name for "${item.name}"`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Rename',
                  onPress: async (newName?: string) => {
                    if (!newName?.trim()) return;
                    try {
                      await mindosClient.renameFile(item.path, newName.trim());
                      await load();
                    } catch (e) {
                      Alert.alert('Error', (e as Error).message);
                    }
                  },
                },
              ],
              'plain-text',
              getRenameInputDefaultValue(item.name),
            );
          } else {
            setRenameTarget(item);
            setRenameModalVisible(true);
          }
          break;
        case 1: // Delete
          Alert.alert(
            'Delete File',
            `Are you sure you want to delete "${item.name}"? It will be moved to trash.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await mindosClient.deleteFile(item.path);
                    await load();
                  } catch (e) {
                    Alert.alert('Error', (e as Error).message);
                  }
                },
              },
            ],
          );
          break;
        case 2: // View Path
          Alert.alert(item.name, item.path);
          break;
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, destructiveButtonIndex: destructiveIndex, cancelButtonIndex: cancelIndex },
        handleAction,
      );
    } else {
      if (!isFile) {
        Alert.alert(item.name, item.path);
        return;
      }
      Alert.alert(
        item.name,
        item.path,
        [
          { text: 'Rename', onPress: () => handleAction(0) },
          { text: 'Delete', style: 'destructive', onPress: () => handleAction(1) },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    }
  };

  const handleRenameSubmit = async (newName: string) => {
    if (!renameTarget) return;
    const target = renameTarget;
    setRenameModalVisible(false);
    try {
      await mindosClient.renameFile(target.path, newName);
      await load();
      setRenameTarget(null);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  function iconForNode(node: FileNode) {
    if (node.type === 'directory') {
      return node.isSpace ? 'layers-outline' : 'folder-outline';
    }
    if (node.extension === '.csv') return 'grid-outline';
    return 'document-text-outline';
  }

  const handleItemPress = (item: FileNode) => {
    if (item.type === 'directory') {
      setCurrentPath(item.path);
    } else {
      router.push(`/view/${item.path}` as any);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/* Breadcrumb navigation */}
      <Breadcrumb currentPath={currentPath} onNavigate={setCurrentPath} />

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
        data={viewState.tree}
        keyExtractor={(item) => item.path}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#c8873a" />
        }
        ListHeaderComponent={viewState.banner ? <FilesErrorBanner banner={viewState.banner} onRetry={load} /> : null}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => handleItemPress(item)}
            onLongPress={() => handleLongPress(item)}
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
        ListEmptyComponent={viewState.showEmptyState ? (
          <View style={styles.empty}>
            <Ionicons
              name={currentPath ? 'folder-open-outline' : 'document-text-outline'}
              size={48}
              color="#44403c"
            />
            <Text style={styles.emptyText}>
              {currentPath ? 'This folder is empty' : 'No files yet'}
            </Text>
            <Pressable
              style={styles.createFirstBtn}
              onPress={() => setShowNewFile(true)}
            >
              <Text style={styles.createFirstText}>
                {currentPath ? 'Create a note here' : 'Create your first note'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      />

      {/* FAB: New file */}
      {!showNewFile && (
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          onPress={() => setShowNewFile(true)}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      )}

      {/* Android rename modal */}
      <TextInputModal
        visible={renameModalVisible}
        title="Rename File"
        message={`Enter new name for "${renameTarget?.name ?? ''}"`}
        placeholder="New file name"
        defaultValue={getRenameInputDefaultValue(renameTarget?.name ?? '')}
        onSubmit={handleRenameSubmit}
        onCancel={() => { setRenameModalVisible(false); setRenameTarget(null); }}
        submitText="Rename"
      />
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
  fabPressed: {
    transform: [{ scale: 0.9 }],
    opacity: 0.8,
  },
});
