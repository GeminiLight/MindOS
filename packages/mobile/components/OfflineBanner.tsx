/**
 * OfflineBanner — Shows a persistent warning when server connection is lost.
 * Place at the top of tab screens.
 */
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useConnectionStore } from '@/lib/connection-store';
import { formatConnectionDiagnostic } from '@/lib/connection-diagnostics';
import { colors, hairlineWidth, radius, spacing, typography } from '@/lib/theme';

export default function OfflineBanner() {
  const status = useConnectionStore((s) => s.status);
  const diagnostic = useConnectionStore((s) => s.diagnostic);
  const checkHealth = useConnectionStore((s) => s.checkHealth);

  if (status === 'connected' || status === 'disconnected') return null;

  const isChecking = status === 'connecting';
  const display = formatConnectionDiagnostic(diagnostic);
  const isError = display.tone === 'error';
  const accent = isError ? colors.errorText : colors.warning;

  return (
    <View style={[styles.banner, isError ? styles.errorBanner : styles.warningBanner]}>
      {isChecking ? (
        <ActivityIndicator size={12} color={accent} />
      ) : (
        <Ionicons name="cloud-offline-outline" size={14} color={accent} />
      )}
      <Text style={[styles.text, { color: accent }]}>
        {isChecking ? 'Checking connection' : display.title}
      </Text>
      {!isChecking && (
        <Pressable onPress={checkHealth} style={styles.retryBtn} hitSlop={8}>
          <Text style={[styles.retryText, { color: accent }]}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: hairlineWidth,
  },
  warningBanner: {
    backgroundColor: colors.warningSoft,
    borderBottomColor: colors.warningBorder,
  },
  errorBanner: {
    backgroundColor: colors.errorSoft,
    borderBottomColor: colors.errorBorder,
  },
  text: {
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '500',
  },
  retryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  retryText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
});
