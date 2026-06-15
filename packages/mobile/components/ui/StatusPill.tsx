import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface StatusPillProps {
  label: string;
  tone?: StatusTone;
}

type StatusTone = 'success' | 'warning' | 'error' | 'muted';

export default function StatusPill({ label, tone = 'muted' }: StatusPillProps) {
  return (
    <View style={[styles.pill, toneStyles[tone]]}>
      <View style={[styles.dot, dotStyles[tone]]} />
      <Text style={[styles.label, labelStyles[tone]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 28,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
  },
  success: {
    backgroundColor: colors.successSoft,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warningBorder,
  },
  error: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.errorBorder,
  },
  muted: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderSubtle,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  successDot: { backgroundColor: colors.success },
  warningDot: { backgroundColor: colors.warning },
  errorDot: { backgroundColor: colors.error },
  mutedDot: { backgroundColor: colors.textSubtle },
  label: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  successLabel: { color: colors.success },
  warningLabel: { color: colors.warning },
  errorLabel: { color: colors.errorText },
  mutedLabel: { color: colors.textMuted },
});

const toneStyles: Record<StatusTone, object> = {
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
  muted: styles.muted,
};

const dotStyles: Record<StatusTone, object> = {
  success: styles.successDot,
  warning: styles.warningDot,
  error: styles.errorDot,
  muted: styles.mutedDot,
};

const labelStyles: Record<StatusTone, object> = {
  success: styles.successLabel,
  warning: styles.warningLabel,
  error: styles.errorLabel,
  muted: styles.mutedLabel,
};
