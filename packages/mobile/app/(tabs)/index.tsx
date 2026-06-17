/**
 * Home tab - Spaces overview, quick capture, and recently active files.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import QuickCaptureCard from '@/components/QuickCaptureCard';
import RecentAgentActivityCard from '@/components/agent/RecentAgentActivityCard';
import {
  EmptyState,
  InlineBanner,
  ListRow,
  MindScreen,
  ScreenSection,
} from '@/components/ui/MobileScaffold';
import { useRecentAgentActivity } from '@/hooks/useRecentAgentActivity';
import { mindosClient } from '@/lib/api-client';
import { useConnectionStore } from '@/lib/connection-store';
import { flattenFiles, formatRelativeTime } from '@/lib/file-tree';
import { getHomeEmptyState } from '@/lib/home-state';
import { getFileNodeIcon } from '@/lib/mobile-icons';
import { filesTabHref, viewFileHref } from '@/lib/mobile-navigation';
import { colors, radius, spacing, typography } from '@/lib/theme';
import type { FileNode } from '@/lib/types';

export default function HomeScreen() {
  const router = useRouter();
  const { serverVersion, hostname, status } = useConnectionStore();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const {
    summary: recentAgentActivitySummary,
    loading: recentAgentActivityLoading,
    refreshing: recentAgentActivityRefreshing,
    error: recentAgentActivityError,
    lastCheckedAt: recentAgentActivityLastCheckedAt,
    refresh: refreshRecentAgentActivity,
  } = useRecentAgentActivity({
    enabled: status === 'connected',
    limit: 6,
  });

  const loadData = useCallback(async () => {
    try {
      setError('');
      const result = await mindosClient.getFileTreeWithStatus();
      setTree(result.tree);
      setError(result.stale ? (result.error ?? 'Showing cached Home data. Pull to retry.') : '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadData(),
      status === 'connected' ? refreshRecentAgentActivity() : Promise.resolve(),
    ]);
    setRefreshing(false);
  }, [loadData, refreshRecentAgentActivity, status]);

  const spaces = tree.filter((n) => n.type === 'directory' && n.isSpace);
  const allFiles = flattenFiles(tree);
  const recentFiles = allFiles
    .filter((file) => typeof file.mtime === 'number' && file.mtime > 0)
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .slice(0, 10);
  const emptyState = getHomeEmptyState({
    fileCount: allFiles.length,
    spaceCount: spaces.length,
    recentCount: recentFiles.length,
    hasError: Boolean(error),
  });

  return (
    <MindScreen>
      <FlatList
        data={recentFiles}
        keyExtractor={(item) => item.path}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.amber}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.heroCard}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>Mobile workspace</Text>
                <Text style={styles.heroTitle} numberOfLines={1}>
                  {hostname || 'MindOS'}
                </Text>
                <Text style={styles.heroMeta} numberOfLines={1}>
                  {status === 'connected'
                    ? `Connected · v${serverVersion || 'unknown'}`
                    : status === 'connecting'
                      ? 'Checking connection'
                      : 'Offline control surface'}
                </Text>
              </View>
              <View style={[
                styles.statusBadge,
                status === 'connected'
                  ? styles.statusBadgeConnected
                  : status === 'connecting'
                    ? styles.statusBadgeChecking
                    : styles.statusBadgeError,
              ]}>
                <View style={[
                  styles.statusDot,
                  status === 'connected'
                    ? styles.statusDotConnected
                    : status === 'connecting'
                      ? styles.statusDotChecking
                      : styles.statusDotError,
                ]} />
                <Text style={styles.statusBadgeText}>
                  {status === 'connected' ? 'Ready' : status === 'connecting' ? 'Checking' : 'Offline'}
                </Text>
              </View>
            </View>

            {error ? (
              <View style={styles.bannerPad}>
                <InlineBanner
                  tone="error"
                  title="Home data is temporarily unavailable"
                  message={error}
                  actionLabel="Retry"
                  onAction={loadData}
                />
              </View>
            ) : null}

            <View style={styles.quickCapturePad}>
              <QuickCaptureCard onSaved={loadData} />
            </View>

            {status === 'connected' ? (
              <ScreenSection>
                <RecentAgentActivityCard
                  summary={recentAgentActivitySummary}
                  loading={recentAgentActivityLoading}
                  refreshing={recentAgentActivityRefreshing}
                  error={recentAgentActivityError}
                  lastCheckedAt={recentAgentActivityLastCheckedAt}
                  onRefresh={refreshRecentAgentActivity}
                  onOpenAll={() => router.push('/agent-runs')}
                />
              </ScreenSection>
            ) : null}

            {spaces.length > 0 ? (
              <ScreenSection title="Spaces" subtitle="Jump into a Mind System area.">
                <View style={styles.spacesGrid}>
                  {spaces.map((space) => (
                    <Pressable
                      key={space.path}
                      style={({ pressed }) => [styles.spaceCard, pressed && styles.pressed]}
                      onPress={() => router.push(viewFileHref(space.path))}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${space.name}`}
                    >
                      <View style={styles.spaceIcon}>
                        <Ionicons name="layers-outline" size={18} color={colors.amber} />
                      </View>
                      <View style={styles.spaceCopy}>
                        <Text style={styles.spaceName} numberOfLines={1}>{space.name}</Text>
                        <Text style={styles.spaceCount}>
                          {space.children?.length ?? 0} items
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </ScreenSection>
            ) : null}

            <ScreenSection
              title="Recently Active"
              subtitle={recentFiles.length > 0 ? 'Files with the latest host activity.' : undefined}
              style={recentFiles.length === 0 ? styles.emptySectionHeader : undefined}
            />
          </View>
        }
        renderItem={({ item }) => (
          <ListRow
            icon={getFileNodeIcon(item)}
            title={item.name}
            subtitle={item.mtime ? formatRelativeTime(item.mtime) : item.path}
            onPress={() => router.push(viewFileHref(item.path))}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon={emptyState?.icon ?? 'archive-outline'}
            title={emptyState?.title ?? 'No recent activity yet'}
            message={emptyState?.message ?? 'Open Files to browse your notes.'}
            actionLabel={emptyState?.actionLabel ?? 'Open Files'}
            onAction={() => router.push(filesTabHref)}
          />
        }
      />
    </MindScreen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  heroEyebrow: {
    color: colors.textSubtle,
    fontSize: typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  heroMeta: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  statusBadge: {
    minHeight: 32,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
  },
  statusBadgeConnected: {
    backgroundColor: colors.successSoft,
    borderColor: colors.successBorder,
  },
  statusBadgeChecking: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warningBorder,
  },
  statusBadgeError: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.errorBorder,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotConnected: { backgroundColor: colors.success },
  statusDotChecking: { backgroundColor: colors.warning },
  statusDotError: { backgroundColor: colors.error },
  statusBadgeText: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  bannerPad: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  quickCapturePad: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  spacesGrid: {
    gap: spacing.sm,
  },
  spaceCard: {
    minHeight: 58,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.78,
  },
  spaceIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  spaceCopy: {
    flex: 1,
    minWidth: 0,
  },
  spaceName: { fontSize: typography.bodyLarge, fontWeight: '700', color: colors.text },
  spaceCount: { fontSize: typography.caption, color: colors.textSubtle, marginTop: 2 },
  emptySectionHeader: {
    paddingBottom: 0,
  },
});
