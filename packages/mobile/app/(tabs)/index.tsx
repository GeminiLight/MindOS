/**
 * Home tab — Spaces overview + recently active files.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { mindosClient } from '@/lib/api-client';
import { useConnectionStore } from '@/lib/connection-store';
import QuickCaptureCard from '@/components/QuickCaptureCard';
import { flattenFiles, formatRelativeTime } from '@/lib/file-tree';
import type { FileNode } from '@/lib/types';

export default function HomeScreen() {
  const router = useRouter();
  const { serverVersion, hostname } = useConnectionStore();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    try {
      setError('');
      const files = await mindosClient.getFileTree();
      setTree(files);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const spaces = tree.filter((n) => n.type === 'directory' && n.isSpace);
  const recentFiles = flattenFiles(tree)
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .slice(0, 10);

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={recentFiles}
        keyExtractor={(item) => item.path}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#c8873a"
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.statusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>
                {hostname || 'MindOS'} · v{serverVersion}
              </Text>
            </View>

            {error ? (
              <View style={styles.inlineErrorBanner}>
                <View style={styles.inlineErrorContent}>
                  <Ionicons name="cloud-offline-outline" size={18} color="#fca5a5" />
                  <View style={styles.inlineErrorCopy}>
                    <Text style={styles.inlineErrorTitle}>Home data is temporarily unavailable</Text>
                    <Text style={styles.inlineErrorText}>{error}</Text>
                  </View>
                </View>
                <Pressable style={styles.inlineRetryButton} onPress={loadData}>
                  <Text style={styles.inlineRetryText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            <QuickCaptureCard onSaved={loadData} />

            {spaces.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Spaces</Text>
                <View style={styles.spacesGrid}>
                  {spaces.map((space) => (
                    <Pressable
                      key={space.path}
                      style={styles.spaceCard}
                      onPress={() => router.push(`/view/${space.path}` as any)}
                    >
                      <Ionicons name="layers-outline" size={20} color="#c8873a" />
                      <Text style={styles.spaceName} numberOfLines={1}>{space.name}</Text>
                      <Text style={styles.spaceCount}>
                        {space.children?.length ?? 0} items
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recently Active</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.fileRow}
            onPress={() => router.push(`/view/${item.path}` as any)}
          >
            <Ionicons
              name={item.extension === '.csv' ? 'grid-outline' : 'document-text-outline'}
              size={18}
              color="#a8a29e"
            />
            <View style={styles.fileInfo}>
              <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.fileMeta}>
                {item.mtime ? formatRelativeTime(item.mtime) : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#44403c" />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="archive-outline" size={48} color="#44403c" />
            <Text style={styles.emptyTitle}>Your mind is empty</Text>
            <Text style={styles.emptyText}>
              {error
                ? 'Quick Capture is still available above. Retry Home data, or open Files directly.'
                : 'Start with Quick Capture above, or create a full note in Files.'}
            </Text>
            <Pressable
              style={styles.createBtn}
              onPress={() => router.push('/(tabs)/files' as any)}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.createBtnText}>Open Files</Text>
            </Pressable>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  statusText: { fontSize: 13, color: '#a8a29e' },
  section: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#fafaf9' },
  spacesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  spaceCard: {
    backgroundColor: '#292524',
    borderRadius: 12,
    padding: 16,
    minWidth: 140,
    gap: 6,
    borderWidth: 1,
    borderColor: '#44403c',
  },
  spaceName: { fontSize: 15, fontWeight: '600', color: '#fafaf9' },
  spaceCount: { fontSize: 12, color: '#78716c' },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 15, color: '#fafaf9' },
  fileMeta: { fontSize: 12, color: '#78716c', marginTop: 2 },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#a8a29e' },
  emptyText: { fontSize: 14, color: '#78716c', textAlign: 'center', paddingHorizontal: 40 },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#c8873a',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  createBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  inlineErrorBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    gap: 10,
  },
  inlineErrorContent: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  inlineErrorCopy: { flex: 1 },
  inlineErrorTitle: { fontSize: 13, fontWeight: '600', color: '#fecaca' },
  inlineErrorText: { fontSize: 12, color: '#fca5a5', marginTop: 2 },
  inlineRetryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#c8873a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  inlineRetryText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
