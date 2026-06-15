import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, minTouchTarget, radius, spacing, typography } from '@/lib/theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
type MindButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface MindButtonProps {
  label: string;
  onPress?: () => void;
  variant?: MindButtonVariant;
  icon?: IoniconsName;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export default function MindButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  style,
}: MindButtonProps) {
  const isDisabled = disabled || loading;
  const iconColor = variant === 'primary' ? colors.white
    : variant === 'danger' ? colors.error
      : colors.amber;
  const variantStyle = buttonVariantStyles[variant];
  const labelStyle = buttonLabelStyles[variant];

  return (
    <Pressable
      style={[
        styles.button,
        variantStyle,
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? colors.white : colors.amber} />
      ) : icon ? (
        <Ionicons name={icon} size={16} color={iconColor} />
      ) : null}
      <Text style={[styles.label, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primary: {
    backgroundColor: colors.amber,
  },
  secondary: {
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.amberBorder,
  },
  danger: {
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.errorBorder,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  primaryLabel: {
    color: colors.white,
  },
  secondaryLabel: {
    color: colors.amber,
  },
  dangerLabel: {
    color: colors.error,
  },
  ghostLabel: {
    color: colors.textMuted,
  },
});

const buttonVariantStyles: Record<MindButtonVariant, object> = {
  primary: styles.primary,
  secondary: styles.secondary,
  danger: styles.danger,
  ghost: styles.ghost,
};

const buttonLabelStyles: Record<MindButtonVariant, object> = {
  primary: styles.primaryLabel,
  secondary: styles.secondaryLabel,
  danger: styles.dangerLabel,
  ghost: styles.ghostLabel,
};
