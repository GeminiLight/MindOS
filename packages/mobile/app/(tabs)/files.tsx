/**
 * Files tab — file tree browser with folder drill-down navigation.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
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
import { Ionicons } from '@expo/vector-icons';
import { mindosClient } from '@/lib/api-client';
import TextInputModal from '@/components/TextInputModal';
import Breadcrumb from '@/components/Breadcrumb';
import MindTextInput from '@/components/ui/MindTextInput';
import {
  EmptyState,
  InlineBanner,
  ListRow,
  MindScreen,
} from '@/components/ui/MobileScaffold';
import {
  getFilesErrorMessage,
  getFilesTabViewState,
  getRenameInputDefaultValue,
  normalizeNewMarkdownFileName,
  normalizeRenameTarget,
} from '@/lib/files-tab-state';
import { getChildrenAtPath, getParentPath, sortFileNodes } from '@/lib/file-tree';
import { getFileNodeIcon } from '@/lib/mobile-icons';
import { viewFileHref } from '@/lib/mobile-navigation';
import { colors, hairlineWidth, hitSlop, minTouchTarget, radius, shadows, spacing, typography } from '@/lib/theme';
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
      const result = await mindosClient.getFileTreeWithStatus();
      setTree(result.tree);
      setError(result.stale ? (result.error ?? 'Showing cached files. Pull to retry.') : '');
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

  const openFile = useCallback((filePath: string) => {
    router.push(viewFileHref(filePath));
  }, [router]);

  const resetCreateFileDraft = useCallback(() => {
    setShowNewFile(false);
    setNewFileName('');
  }, []);

  const promptOpenExistingFile = useCallback((baseName: string, filePath: string) => {
    Alert.alert(
      'File Exists',
      `"${baseName}" already exists. Open it instead?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open',
          onPress: () => {
            resetCreateFileDraft();
            openFile(filePath);
          },
        },
      ],
    );
  }, [openFile, resetCreateFileDraft]);

  const handleCreateFile = useCallback(async () => {
    const normalized = normalizeNewMarkdownFileName(newFileName);
    if (!normalized.ok) {
      Alert.alert('Invalid File Name', normalized.message);
      return;
    }

    const baseName = normalized.fileName;
    const filePath = currentPath ? `${currentPath}/${baseName}` : baseName;
    setCreating(true);
    try {
      const exists = await mindosClient.fileExists(filePath);
      if (exists) {
        promptOpenExistingFile(baseName, filePath);
        return;
      }
      const created = await mindosClient.createFile(filePath, `# ${normalized.title}\n\n`);
      if (!created.ok && created.error === 'exists') {
        promptOpenExistingFile(baseName, filePath);
        return;
      }
      resetCreateFileDraft();
      await load();
      openFile(filePath);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setCreating(false);
    }
  }, [newFileName, currentPath, load, openFile, promptOpenExistingFile, resetCreateFileDraft]);

  if (loading) {
    return (
      <MindScreen>
        <EmptyState
          icon="folder-open-outline"
          title="Loading files"
          message="Refreshing the mobile file index."
          loading
        />
      </MindScreen>
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
                    const normalized = normalizeRenameTarget(item.name, newName ?? '');
                    if (!normalized.ok) {
                      Alert.alert('Invalid File Name', normalized.message);
                      return;
                    }
                    try {
                      await mindosClient.renameFile(item.path, normalized.fileName);
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
    const normalized = normalizeRenameTarget(target.name, newName);
    if (!normalized.ok) {
      Alert.alert('Invalid File Name', normalized.message);
      return;
    }
    setRenameModalVisible(false);
    try {
      await mindosClient.renameFile(target.path, normalized.fileName);
      await load();
      setRenameTarget(null);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  const handleItemPress = (item: FileNode) => {
    if (item.type === 'directory') {
      setCurrentPath(item.path);
    } else {
      openFile(item.path);
    }
  };

  return (
    <MindScreen>
      {/* Breadcrumb navigation */}
      <Breadcrumb currentPath={currentPath} onNavigate={setCurrentPath} />

      {/* New file input */}
      {showNewFile && (
        <View style={styles.newFileBar}>
          <MindTextInput
            style={styles.newFileInput}
            value={newFileName}
            onChangeText={setNewFileName}
            placeholder="File name..."
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
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="checkmark" size={18} color={colors.white} />
            )}
          </Pressable>
          <Pressable
            style={styles.newFileCancelBtn}
            onPress={resetCreateFileDraft}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Cancel new file"
          >
            <Ionicons name="close" size={18} color={colors.textSubtle} />
          </Pressable>
        </View>
      )}

      <FlatList
        data={viewState.tree}
        keyExtractor={(item) => item.path}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.amber} />
        }
        contentContainerStyle={viewState.showEmptyState ? styles.emptyList : undefined}
        initialNumToRender={18}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        ListHeaderComponent={viewState.banner ? (
          <View style={styles.bannerPad}>
            <InlineBanner
              tone="error"
              title={viewState.banner.title}
              message={viewState.banner.message}
              actionLabel={viewState.banner.showRetry ? 'Retry' : undefined}
              onAction={viewState.banner.showRetry ? load : undefined}
            />
          </View>
        ) : null}
        renderItem={({ item }) => (
          <ListRow
            icon={getFileNodeIcon(item)}
            iconColor={item.isSpace ? colors.amber : colors.textMuted}
            title={item.name}
            subtitle={item.type === 'directory'
              ? `${item.children?.length ?? 0} items`
              : item.path}
            onPress={() => handleItemPress(item)}
            onLongPress={() => handleLongPress(item)}
            accessibilityLabel={`Open ${item.path}`}
          />
        )}
        ListEmptyComponent={viewState.showEmptyState ? (
          <EmptyState
            icon={currentPath ? 'folder-open-outline' : 'document-text-outline'}
            title={currentPath ? 'This folder is empty' : 'No files yet'}
            message={currentPath
              ? 'Create a note here to keep this context together.'
              : 'Create your first note, or pull to refresh if this device was just connected.'}
            actionLabel={currentPath ? 'Create a note here' : 'Create your first note'}
            onAction={() => setShowNewFile(true)}
          />
        ) : null}
      />

      {/* FAB: New file */}
      {!showNewFile && (
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          onPress={() => setShowNewFile(true)}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Create new note"
        >
          <Ionicons name="add" size={24} color={colors.white} />
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
    </MindScreen>
  );
}

const styles = StyleSheet.create({
  newFileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  newFileInput: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body,
  },
  newFileBtn: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.amber,
    justifyContent: 'center',
    alignItems: 'center',
  },
  newFileBtnDisabled: { opacity: 0.4 },
  newFileCancelBtn: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerPad: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  emptyList: {
    flexGrow: 1,
  },
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.amber,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.floating,
  },
  fabPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.86,
  },
});
