import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  runtimeKey,
  type RuntimeCompanionOption,
} from '@/lib/agent-runtime-companion';
import type { AgentRuntimeIdentity, AgentRuntimeKind } from '@/lib/types';
import { colors, hairlineWidth, hitSlop, radius, spacing, typography } from '@/lib/theme';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

interface RuntimePickerSheetProps {
  visible: boolean;
  options: RuntimeCompanionOption[];
  selectedRuntime: AgentRuntimeIdentity | null;
  loading?: boolean;
  refreshing?: boolean;
  error?: string;
  lastCheckedAt?: number | null;
  switchDisabled?: boolean;
  onRefresh?: () => void;
  onSelect: (option: RuntimeCompanionOption) => void;
  onClose: () => void;
}

export default function RuntimePickerSheet({
  visible,
  options,
  selectedRuntime,
  loading = false,
  refreshing = false,
  error = '',
  lastCheckedAt = null,
  switchDisabled = false,
  onRefresh,
  onSelect,
  onClose,
}: RuntimePickerSheetProps) {
  const selectedKey = runtimeKey(selectedRuntime);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.sheetHeader}>
            <View style={styles.headerIcon}>
              <Ionicons name="git-branch-outline" size={18} color={colors.amber} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.sheetTitle}>Agent Runtime</Text>
              <Text style={styles.sheetSubtitle}>
                Runs on the connected MindOS host. Mobile only routes the chat.
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={hitSlop} style={styles.closeButton}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBanner}>
              <Ionicons name="warning-outline" size={16} color={colors.errorText} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.optionList}>
            {options.map((option) => {
              const selected = option.id === selectedKey;
              const disabled = switchDisabled || !option.selectable;
              return (
                <Pressable
                  key={option.id}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled, selected }}
                  onPress={() => onSelect(option)}
                  style={[
                    styles.optionRow,
                    selected && styles.optionRowSelected,
                    disabled && styles.optionRowDisabled,
                  ]}
                >
                  <View style={[styles.optionIcon, option.tone === 'success' && styles.optionIconReady]}>
                    <Ionicons
                      name={iconForRuntimeKind(option.kind)}
                      size={18}
                      color={iconColorForTone(option.tone)}
                    />
                  </View>
                  <View style={styles.optionCopy}>
                    <View style={styles.optionTitleRow}>
                      <Text style={styles.optionName} numberOfLines={1}>{option.name}</Text>
                      <View style={[styles.statusDot, statusDotStyle(option.tone)]} />
                    </View>
                    <Text style={styles.optionSubtitle} numberOfLines={1}>
                      {option.bridgeLabel ?? option.subtitle}
                    </Text>
                    <Text style={styles.optionDetail} numberOfLines={2}>
                      {switchDisabled && option.selectable
                        ? 'Finish the current response before switching runtime.'
                        : option.detail}
                    </Text>
                  </View>
                  <View style={styles.optionTrailing}>
                    <Text style={styles.optionStatus} numberOfLines={1}>{option.statusLabel}</Text>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.amber} />
                    ) : (
                      <Ionicons
                        name={option.selectable ? 'chevron-forward' : 'lock-closed-outline'}
                        size={17}
                        color={colors.textSubtle}
                      />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>
              {loading
                ? 'Checking runtime status...'
                : lastCheckedAt
                  ? `Checked ${formatCheckedAt(lastCheckedAt)}`
                  : 'Only ready runtimes can be selected.'}
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
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function iconForRuntimeKind(kind: AgentRuntimeKind): IoniconsName {
  if (kind === 'codex') return 'terminal-outline';
  if (kind === 'claude') return 'code-slash-outline';
  if (kind === 'acp') return 'git-network-outline';
  return 'sparkles-outline';
}

function iconColorForTone(tone: RuntimeCompanionOption['tone']): string {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  if (tone === 'error') return colors.errorText;
  return colors.textSubtle;
}

function statusDotStyle(tone: RuntimeCompanionOption['tone']) {
  if (tone === 'success') return styles.statusDotSuccess;
  if (tone === 'warning') return styles.statusDotWarning;
  if (tone === 'error') return styles.statusDotError;
  return styles.statusDotMuted;
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
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.scrim,
  },
  sheet: {
    maxHeight: '88%',
    padding: spacing.lg,
    gap: spacing.md,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.background,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
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
  optionList: {
    gap: spacing.sm,
  },
  optionRow: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  optionRowSelected: {
    borderColor: colors.amberBorder,
    backgroundColor: colors.amberSoft,
  },
  optionRowDisabled: {
    opacity: 0.62,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  optionIconReady: {
    backgroundColor: colors.successSoft,
  },
  optionCopy: {
    flex: 1,
    gap: 3,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  optionName: {
    flexShrink: 1,
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: '700',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDotSuccess: { backgroundColor: colors.success },
  statusDotWarning: { backgroundColor: colors.warning },
  statusDotError: { backgroundColor: colors.error },
  statusDotMuted: { backgroundColor: colors.textSubtle },
  optionSubtitle: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  optionDetail: {
    color: colors.textSubtle,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  optionTrailing: {
    minWidth: 58,
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  optionStatus: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  footerRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.xs,
    borderTopWidth: hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  footerText: {
    flex: 1,
    color: colors.textSubtle,
    fontSize: typography.caption,
    lineHeight: 17,
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
