import { PropsWithChildren } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '@/lib/theme';

interface MindCardProps {
  tone?: 'default' | 'success' | 'warning' | 'error';
  style?: ViewStyle;
}

export default function MindCard({
  tone = 'default',
  style,
  children,
}: PropsWithChildren<MindCardProps>) {
  return (
    <View style={[styles.card, styles[tone], style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  default: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
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
});
