import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ComponentProps } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MindButton from '@/components/ui/MindButton';
import MindCard from '@/components/ui/MindCard';
import StatusPill from '@/components/ui/StatusPill';
import { RecentAgentActivityListRow } from '@/components/agent/RecentAgentActivityCard';
import CloudTaskDraftCard from '@/components/agent/CloudTaskDraftCard';
import ServerRequirementsCard from '@/components/agent/ServerRequirementsCard';
import { useConnectionStore } from '@/lib/connection-store';
import { useRecentAgentActivity } from '@/hooks/useRecentAgentActivity';
import {
  buildRecentAgentActivityFilterOptions,
  filterRecentAgentActivityItems,
  type RecentAgentActivityFilter,
} from '@/lib/recent-agent-activity';
import { colors, hairlineWidth, hitSlop, radius, spacing, typography } from '@/lib/theme';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const CLOUD_BRIDGES: Array<{
  id: string;
  name: string;
  detail: string;
  icon: IoniconsName;
}> = [
  {
    id: 'codex-cloud',
    name: 'Codex Cloud',
    detail: 'Needs a Product Server task adapter for repo, branch, diff, and review state.',
    icon: 'terminal-outline',
  },
  {
    id: 'claude-code-web',
    name: 'Claude Code Web',
    detail: 'Needs remote session/task sync before mobile can resume or approve work.',
    icon: 'code-slash-outline',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot agent',
    detail: 'Needs issue, branch, PR, and checkpoint events from the server side.',
    icon: 'git-pull-request-outline',
  },
];

export default function AgentRunsScreen() {
  const router = useRouter();
  const { status } = useConnectionStore();
  const connected = status === 'connected';
  const [filter, setFilter] = useState<RecentAgentActivityFilter>('all');
  const activity = useRecentAgentActivity({
    enabled: connected,
    limit: 40,
  });

  const filterOptions = useMemo(
    () => buildRecentAgentActivityFilterOptions(activity.summary),
    [activity.summary],
  );
  const visibleItems = useMemo(
    () => filterRecentAgentActivityItems(activity.summary.items, filter),
    [activity.summary.items, filter],
  );

  useEffect(() => {
    const selected = filterOptions.find((item) => item.id === filter);
    if (filter !== 'all' && selected?.count === 0) setFilter('all');
  }, [filter, filterOptions]);

  const headerStatus = activity.summary.pendingUserActionCount > 0
    ? { label: `${activity.summary.pendingUserActionCount} waiting`, tone: 'warning' as const }
    : activity.summary.activeCount > 0
      ? { label: `${activity.summary.activeCount} active`, tone: 'warning' as const }
      : activity.summary.failedCount > 0
        ? { label: `${activity.summary.failedCount} issue${activity.summary.failedCount === 1 ? '' : 's'}`, tone: 'error' as const }
        : { label: connected ? 'Ready' : 'Offline', tone: connected ? 'success' as const : 'muted' as const };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={activity.refreshing}
            onRefresh={() => {
              void activity.refresh();
            }}
            tintColor={colors.amber}
          />
        }
      >
        <MindCard>
          <View style={styles.heroRow}>
            <View style={styles.heroIcon}>
              <Ionicons name="git-branch-outline" size={20} color={colors.amber} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Agent Runs</Text>
              <Text style={styles.heroText}>
                Host-side Codex, Claude Code, Pi, ACP, and A2A activity.
              </Text>
            </View>
            <StatusPill label={headerStatus.label} tone={headerStatus.tone} />
          </View>
        </MindCard>

        {!connected ? (
          <MindCard tone="warning">
            <View style={styles.noticeRow}>
              <Ionicons name="wifi-outline" size={20} color={colors.warning} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Connect to a MindOS host</Text>
                <Text style={styles.noticeText}>
                  Agent runs live on the connected computer or cloud workspace.
                </Text>
              </View>
            </View>
            <MindButton
              label="Connect"
              icon="link-outline"
              variant="secondary"
              onPress={() => router.push('/connect')}
            />
          </MindCard>
        ) : null}

        {activity.error ? (
          <MindCard tone="error">
            <View style={styles.noticeRow}>
              <Ionicons name="warning-outline" size={20} color={colors.errorText} />
              <View style={styles.noticeCopy}>
                <Text style={styles.errorTitle}>Agent activity unavailable</Text>
                <Text style={styles.errorText}>{activity.error}</Text>
              </View>
            </View>
          </MindCard>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Host Activity</Text>
          <Pressable
            onPress={() => {
              void activity.refresh();
            }}
            disabled={!connected || activity.loading || activity.refreshing}
            hitSlop={hitSlop}
            style={[styles.refreshButton, (!connected || activity.loading || activity.refreshing) && styles.refreshButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Refresh agent runs"
          >
            {activity.refreshing ? (
              <ActivityIndicator size="small" color={colors.amber} />
            ) : (
              <Ionicons name="refresh-outline" size={17} color={colors.amber} />
            )}
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filterOptions.map((option) => {
            const selected = option.id === filter;
            return (
              <Pressable
                key={option.id}
                onPress={() => setFilter(option.id)}
                disabled={!connected || option.count === 0}
                style={[
                  styles.filterChip,
                  selected && styles.filterChipSelected,
                  (!connected || option.count === 0) && styles.filterChipDisabled,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !connected || option.count === 0 }}
              >
                <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                  {option.label}
                </Text>
                <Text style={[styles.filterCount, selected && styles.filterTextSelected]}>
                  {option.count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <MindCard style={styles.runsCard}>
          {activity.loading && visibleItems.length === 0 ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color={colors.amber} />
              <Text style={styles.emptyText}>Loading agent runs...</Text>
            </View>
          ) : visibleItems.length > 0 ? (
            <View style={styles.runList}>
              {visibleItems.map((item) => (
                <RecentAgentActivityListRow key={item.id} item={item} />
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="trail-sign-outline" size={26} color={colors.textSubtle} />
              <Text style={styles.emptyTitle}>No runs in this view</Text>
              <Text style={styles.emptyText}>
                Start an agent task from Chat, then return here to monitor it.
              </Text>
            </View>
          )}
        </MindCard>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Cloud Task Bridges</Text>
        </View>
        <MindCard>
          {CLOUD_BRIDGES.map((bridge, index) => (
            <View
              key={bridge.id}
              style={[styles.bridgeRow, index < CLOUD_BRIDGES.length - 1 && styles.bridgeRowBorder]}
            >
              <View style={styles.bridgeIcon}>
                <Ionicons name={bridge.icon} size={17} color={colors.textMuted} />
              </View>
              <View style={styles.bridgeCopy}>
                <Text style={styles.bridgeName}>{bridge.name}</Text>
                <Text style={styles.bridgeDetail}>{bridge.detail}</Text>
              </View>
              <StatusPill label="Server" tone="muted" />
            </View>
          ))}
        </MindCard>

        <CloudTaskDraftCard />

        <ServerRequirementsCard />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  heroCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  heroTitle: {
    fontSize: typography.section,
    fontWeight: '700',
    color: colors.text,
  },
  heroText: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textMuted,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  noticeCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  noticeTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  noticeText: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textMuted,
  },
  errorTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.errorText,
  },
  errorText: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.errorText,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  refreshButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  refreshButtonDisabled: {
    opacity: 0.5,
  },
  filterRow: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  filterChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipSelected: {
    borderColor: colors.amberBorder,
    backgroundColor: colors.amberSoft,
  },
  filterChipDisabled: {
    opacity: 0.45,
  },
  filterText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
  },
  filterTextSelected: {
    color: colors.amber,
  },
  filterCount: {
    minWidth: 18,
    overflow: 'hidden',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    textAlign: 'center',
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textSubtle,
    backgroundColor: colors.surfaceRaised,
  },
  runsCard: {
    paddingTop: spacing.sm,
  },
  runList: {
    borderTopWidth: hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  loadingState: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyState: {
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textMuted,
  },
  emptyText: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textSubtle,
    textAlign: 'center',
  },
  bridgeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  bridgeRowBorder: {
    borderBottomWidth: hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  bridgeIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  bridgeCopy: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  bridgeName: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  bridgeDetail: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textSubtle,
  },
});
