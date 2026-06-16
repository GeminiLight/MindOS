import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import type {
  RuntimeCompanionItem,
  RuntimeCompanionSummary,
} from '@/lib/agent-runtime-companion';
import MindCard from '@/components/ui/MindCard';
import StatusPill from '@/components/ui/StatusPill';
import { colors, hitSlop, radius, spacing, typography } from '@/lib/theme';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

interface AgentRuntimeOverviewProps {
  summary: RuntimeCompanionSummary;
  loading?: boolean;
  refreshing?: boolean;
  error?: string;
  lastCheckedAt?: number | null;
  onRefresh?: () => void;
  compact?: boolean;
}

export default function AgentRuntimeOverview({
  summary,
  loading = false,
  refreshing = false,
  error = '',
  lastCheckedAt = null,
  onRefresh,
  compact = false,
}: AgentRuntimeOverviewProps) {
  return (
    <MindCard style={compact ? styles.cardCompact : undefined}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Agent Companion</Text>
          {!compact ? (
            <Text style={styles.subtitle}>
              Local and remote agents stay on their host. Mobile is the control surface.
            </Text>
          ) : null}
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={colors.amber} />
        ) : (
          <StatusPill label={summary.statusLabel} tone={summary.availableCount > 0 ? 'success' : 'muted'} />
        )}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color={colors.errorText} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.runtimeGrid}>
        {summary.items.map((item) => (
          <RuntimeTile key={item.id} item={item} compact={compact} />
        ))}
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>
          {lastCheckedAt ? `Checked ${formatCheckedAt(lastCheckedAt)}` : summary.detail}
        </Text>
        {onRefresh ? (
          <Pressable
            onPress={onRefresh}
            disabled={loading || refreshing}
            hitSlop={hitSlop}
            style={[styles.refreshButton, (loading || refreshing) && styles.refreshButtonDisabled]}
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

function RuntimeTile({ item, compact }: { item: RuntimeCompanionItem; compact: boolean }) {
  const iconColor = item.tone === 'success' ? colors.success
    : item.tone === 'warning' ? colors.warning
      : item.tone === 'error' ? colors.errorText
        : colors.textSubtle;

  return (
    <View style={[styles.runtimeTile, compact && styles.runtimeTileCompact]}>
      <View style={styles.runtimeTopRow}>
        <View style={[styles.iconShell, item.tone === 'success' && styles.iconShellReady]}>
          <Ionicons name={item.icon as IoniconsName} size={16} color={iconColor} />
        </View>
        <View style={[styles.statusDot, statusDotStyle(item.tone)]} />
      </View>
      <Text style={styles.runtimeName} numberOfLines={1}>{item.name}</Text>
      <Text style={styles.runtimeStatus} numberOfLines={1}>{item.statusLabel}</Text>
      {!compact ? (
        <Text style={styles.runtimeHint} numberOfLines={2}>
          {item.bridgeLabel ?? item.mobileRole}
        </Text>
      ) : null}
    </View>
  );
}

function statusDotStyle(tone: RuntimeCompanionItem['tone']) {
  switch (tone) {
    case 'success':
      return styles.statusDotSuccess;
    case 'warning':
      return styles.statusDotWarning;
    case 'error':
      return styles.statusDotError;
    case 'muted':
    default:
      return styles.statusDotMuted;
  }
}

function formatCheckedAt(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  cardCompact: {
    padding: spacing.md,
  },
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
  runtimeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  runtimeTile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 112,
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  runtimeTileCompact: {
    minHeight: 86,
  },
  runtimeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconShell: {
    width: 28,
    height: 28,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  iconShellReady: {
    backgroundColor: colors.successSoft,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotSuccess: { backgroundColor: colors.success },
  statusDotWarning: { backgroundColor: colors.warning },
  statusDotError: { backgroundColor: colors.error },
  statusDotMuted: { backgroundColor: colors.textSubtle },
  runtimeName: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  runtimeStatus: {
    fontSize: typography.caption,
    fontWeight: '600',
    color: colors.textMuted,
  },
  runtimeHint: {
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
    lineHeight: 17,
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
