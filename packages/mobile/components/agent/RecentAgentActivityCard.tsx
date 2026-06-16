import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import MindCard from '@/components/ui/MindCard';
import StatusPill from '@/components/ui/StatusPill';
import { formatRelativeTime } from '@/lib/file-tree';
import type {
  RecentAgentActivityItem,
  RecentAgentActivitySummary,
  RecentAgentActivityTone,
} from '@/lib/recent-agent-activity';
import { colors, hairlineWidth, hitSlop, radius, spacing, typography } from '@/lib/theme';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];
type PillTone = ComponentProps<typeof StatusPill>['tone'];

interface RecentAgentActivityCardProps {
  summary: RecentAgentActivitySummary;
  loading?: boolean;
  refreshing?: boolean;
  error?: string;
  lastCheckedAt?: number | null;
  onRefresh?: () => void;
  onOpenAll?: () => void;
}

export default function RecentAgentActivityCard({
  summary,
  loading = false,
  refreshing = false,
  error = '',
  lastCheckedAt = null,
  onRefresh,
  onOpenAll,
}: RecentAgentActivityCardProps) {
  const items = summary.items.slice(0, 4);
  const status = statusForSummary(summary, loading);

  return (
    <MindCard>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Agent Activity</Text>
          <Text style={styles.subtitle}>Recent runs on your connected host.</Text>
        </View>
        {loading && items.length === 0 ? (
          <ActivityIndicator size="small" color={colors.amber} />
        ) : (
          <View style={styles.headerActions}>
            <StatusPill label={status.label} tone={status.tone} />
            {onOpenAll ? (
              <Pressable
                onPress={onOpenAll}
                hitSlop={hitSlop}
                style={styles.openAllButton}
                accessibilityRole="button"
                accessibilityLabel="Open all agent runs"
              >
                <Ionicons name="list-outline" size={17} color={colors.amber} />
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color={colors.errorText} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {items.length > 0 ? (
        <View style={styles.list}>
          {items.map((item) => (
            <RecentAgentActivityListRow key={item.id} item={item} />
          ))}
        </View>
      ) : !loading ? (
        <View style={styles.emptyRow}>
          <View style={styles.emptyIcon}>
            <Ionicons name="git-branch-outline" size={17} color={colors.textSubtle} />
          </View>
          <View style={styles.emptyCopy}>
            <Text style={styles.emptyTitle}>No recent agent runs</Text>
            <Text style={styles.emptyText}>Start a chat or agent task to see host activity here.</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.footerRow}>
        <Text style={styles.footerText} numberOfLines={1}>
          {summary.pendingUserActionCount > 0
            ? `${summary.pendingUserActionCount} item${summary.pendingUserActionCount === 1 ? '' : 's'} waiting on host action`
            : lastCheckedAt
              ? `Updated ${formatRelativeTime(lastCheckedAt)}`
              : 'Host run ledger'}
        </Text>
        {onRefresh ? (
          <Pressable
            onPress={onRefresh}
            disabled={loading || refreshing}
            hitSlop={hitSlop}
            style={[styles.refreshButton, (loading || refreshing) && styles.refreshButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Refresh agent activity"
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.amber} />
            ) : (
              <Ionicons name="refresh-outline" size={17} color={colors.amber} />
            )}
          </Pressable>
        ) : null}
      </View>
    </MindCard>
  );
}

export function RecentAgentActivityListRow({ item }: { item: RecentAgentActivityItem }) {
  return (
    <View style={styles.itemRow}>
      <View style={[styles.itemIconShell, iconShellStyle(item.tone)]}>
        <Ionicons name={iconForItem(item)} size={15} color={colorForTone(item.tone)} />
      </View>
      <View style={styles.itemCopy}>
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.itemStatus, item.pendingUserAction && styles.itemStatusWarning]} numberOfLines={1}>
            {item.statusLabel}
          </Text>
        </View>
        <Text style={styles.itemDetail} numberOfLines={2}>
          {item.detail ?? 'No summary yet'}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.runtimePill} numberOfLines={1}>{item.runtimeLabel}</Text>
          <Text style={styles.metaText}>{formatRelativeTime(item.completedAt ?? item.startedAt)}</Text>
          {item.eventCount > 0 ? <Text style={styles.metaText}>{item.eventCount} event{item.eventCount === 1 ? '' : 's'}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function statusForSummary(
  summary: RecentAgentActivitySummary,
  loading: boolean,
): { label: string; tone: PillTone } {
  if (loading && summary.items.length === 0) return { label: 'Checking', tone: 'muted' };
  if (summary.pendingUserActionCount > 0) {
    return { label: `${summary.pendingUserActionCount} waiting`, tone: 'warning' };
  }
  if (summary.failedCount > 0) return { label: `${summary.failedCount} issue${summary.failedCount === 1 ? '' : 's'}`, tone: 'error' };
  if (summary.activeCount > 0) return { label: `${summary.activeCount} active`, tone: 'warning' };
  if (summary.totalCount > 0) return { label: `${summary.totalCount} recent`, tone: 'success' };
  return { label: 'Idle', tone: 'muted' };
}

function iconForItem(item: RecentAgentActivityItem): IoniconsName {
  if (item.pendingUserAction) return 'hand-left-outline';
  if (item.status === 'completed') return 'checkmark-circle-outline';
  if (item.status === 'failed' || item.status === 'timed_out') return 'warning-outline';
  if (item.status === 'canceled') return 'stop-circle-outline';
  return 'sync-outline';
}

function colorForTone(tone: RecentAgentActivityTone): string {
  if (tone === 'success') return colors.success;
  if (tone === 'warning' || tone === 'active') return colors.amber;
  if (tone === 'error') return colors.errorText;
  return colors.textSubtle;
}

function iconShellStyle(tone: RecentAgentActivityTone) {
  if (tone === 'success') return styles.itemIconShellSuccess;
  if (tone === 'warning' || tone === 'active') return styles.itemIconShellWarning;
  if (tone === 'error') return styles.itemIconShellError;
  return null;
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  openAllButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textMuted,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    backgroundColor: colors.errorSoft,
  },
  errorText: {
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.errorText,
  },
  list: {
    borderTopWidth: hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  itemIconShell: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  itemIconShellSuccess: {
    backgroundColor: colors.successSoft,
  },
  itemIconShellWarning: {
    backgroundColor: colors.amberSoft,
  },
  itemIconShellError: {
    backgroundColor: colors.errorSoft,
  },
  itemCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemTitle: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  itemStatus: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.textMuted,
  },
  itemStatusWarning: {
    color: colors.warning,
  },
  itemDetail: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  runtimePill: {
    maxWidth: 120,
    overflow: 'hidden',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.surfaceRaised,
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  metaText: {
    fontSize: typography.caption,
    color: colors.textSubtle,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
  },
  emptyIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  emptyCopy: {
    flex: 1,
    gap: spacing.xs / 2,
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
  },
  footerRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  footerText: {
    flex: 1,
    fontSize: typography.caption,
    color: colors.textSubtle,
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  refreshButtonDisabled: {
    opacity: 0.5,
  },
});
