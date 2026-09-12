import OfflineBanner from '@/components/OfflineBanner';
import { hairlineWidth, hitSlop, minTouchTarget, radius, spacing, typography, useThemedStyles, type ThemeColors } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
type StatusTone = 'default' | 'success' | 'warning' | 'error' | 'muted';

interface MindScreenProps {
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export function MindScreen({ edges = ['left', 'right'], style, children }: MindScreenProps) {
  const { styles } = useThemedStyles(createViewTheme);
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges}>
      <OfflineBanner />
      {children}
    </SafeAreaView>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction }: SectionHeaderProps) {
  const { styles } = useThemedStyles(createViewTheme);
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}
          hitSlop={hitSlop}
          accessibilityRole="button"
        >
          <Text style={styles.sectionActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface ScreenSectionProps {
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ScreenSection({
  title,
  subtitle,
  actionLabel,
  onAction,
  style,
  children,
}: PropsWithChildren<ScreenSectionProps>) {
  const { styles } = useThemedStyles(createViewTheme);
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <SectionHeader title={title} subtitle={subtitle} actionLabel={actionLabel} onAction={onAction} />
      ) : null}
      {children}
    </View>
  );
}

interface InlineBannerProps {
  title: string;
  message?: string;
  tone?: Exclude<StatusTone, 'default'>;
  icon?: IoniconsName;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function InlineBanner({
  title,
  message,
  tone = 'muted',
  icon,
  actionLabel,
  onAction,
  style,
}: InlineBannerProps) {
  const { tonePalette, styles } = useThemedStyles(createViewTheme);
  const palette = tonePalette[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.background, borderColor: palette.border }, style]}>
      <Ionicons name={icon ?? palette.icon} size={18} color={palette.iconColor} />
      <View style={styles.bannerCopy}>
        <Text style={[styles.bannerTitle, { color: palette.text }]}>{title}</Text>
        {message ? <Text style={[styles.bannerMessage, { color: palette.text }]}>{message}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.bannerAction, pressed && styles.pressed]}
          hitSlop={hitSlop}
          accessibilityRole="button"
        >
          <Text style={[styles.bannerActionText, { color: palette.action }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface EmptyStateProps {
  icon: IoniconsName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  loading = false,
  style,
}: EmptyStateProps) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  return (
    <View style={[styles.emptyState, style]}>
      <View style={styles.emptyIconShell}>
        {loading ? (
          <ActivityIndicator color={colors.amber} />
        ) : (
          <Ionicons name={icon} size={32} color={colors.textSubtle} />
        )}
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface ListRowProps {
  icon: IoniconsName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
}

export function ListRow({
  icon,
  iconColor,
  title,
  subtitle,
  right,
  onPress,
  onLongPress,
  accessibilityLabel,
}: ListRowProps) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
    >
      <View style={styles.rowIconShell}>
        <Ionicons name={icon} size={19} color={iconColor ?? colors.textMuted} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} /> : null)}
    </Pressable>
  );
}

function createViewTheme(colors: ThemeColors) {
  const tonePalette: Record<Exclude<StatusTone, 'default'>, {
    background: string;
    border: string;
    text: string;
    iconColor: string;
    action: string;
    icon: IoniconsName;
  }> = {
    success: {
      background: colors.successSoft,
      border: colors.successBorder,
      text: colors.text,
      iconColor: colors.success,
      action: colors.success,
      icon: 'checkmark-circle-outline',
    },
    warning: {
      background: colors.warningSoft,
      border: colors.warningBorder,
      text: colors.text,
      iconColor: colors.warning,
      action: colors.warning,
      icon: 'alert-circle-outline',
    },
    error: {
      background: colors.errorSoft,
      border: colors.errorBorder,
      text: colors.errorText,
      iconColor: colors.errorText,
      action: colors.errorText,
      icon: 'warning-outline',
    },
    muted: {
      background: colors.surfaceMuted,
      border: colors.borderSubtle,
      text: colors.textMuted,
      iconColor: colors.textSubtle,
      action: colors.amber,
      icon: 'information-circle-outline',
    },
  };

  const styles = StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    section: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    sectionCopy: {
      flex: 1,
      gap: spacing.xs,
    },
    sectionTitle: {
      fontSize: typography.section,
      fontWeight: '700',
      color: colors.text,
    },
    sectionSubtitle: {
      fontSize: typography.body,
      color: colors.textSubtle,
      lineHeight: 20,
    },
    sectionAction: {
      minHeight: minTouchTarget,
      justifyContent: 'center',
    },
    sectionActionText: {
      color: colors.amber,
      fontSize: typography.body,
      fontWeight: '700',
    },
    banner: {
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    bannerCopy: {
      flex: 1,
      gap: 2,
    },
    bannerTitle: {
      fontSize: typography.body,
      fontWeight: '700',
    },
    bannerMessage: {
      fontSize: typography.body,
      lineHeight: 20,
    },
    bannerAction: {
      minHeight: 28,
      justifyContent: 'center',
    },
    bannerActionText: {
      fontSize: typography.body,
      fontWeight: '700',
    },
    emptyState: {
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingTop: 72,
      gap: spacing.md,
    },
    emptyIconShell: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: typography.title,
      fontWeight: '700',
      textAlign: 'center',
    },
    emptyMessage: {
      color: colors.textMuted,
      fontSize: typography.body,
      lineHeight: 21,
      textAlign: 'center',
    },
    emptyAction: {
      minHeight: minTouchTarget,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.amberAction,
      marginTop: spacing.xs,
    },
    emptyActionText: {
      color: colors.white,
      fontSize: typography.body,
      fontWeight: '700',
    },
    listRow: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    listRowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    rowIconShell: {
      width: 30,
      height: 30,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    rowTitle: {
      fontSize: typography.bodyLarge,
      color: colors.text,
      fontWeight: '500',
    },
    rowSubtitle: {
      fontSize: typography.caption,
      color: colors.textSubtle,
    },
    pressed: {
      opacity: 0.78,
    },
  });
  return { tonePalette, styles };
}
