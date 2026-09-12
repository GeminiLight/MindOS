import { hairlineWidth, hitSlop, radius, spacing, typography, useThemedStyles, type ThemeColors } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface ChatHeaderProps {
  title: string;
  runtimeLabel: string;
  runtimeStatusLabel: string;
  runtimeReady?: boolean;
  onOpenSessions: () => void;
  onOpenRuntime: () => void;
  onNewChat: () => void;
}

export default function ChatHeader({
  title,
  runtimeLabel,
  runtimeStatusLabel,
  runtimeReady = false,
  onOpenSessions,
  onOpenRuntime,
  onNewChat,
}: ChatHeaderProps) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  return (
    <View style={styles.chatHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="Conversation history" onPress={onOpenSessions} style={styles.iconButton} hitSlop={hitSlop}>
        <Ionicons name="menu-outline" size={22} color={colors.textMuted} />
      </Pressable>
      <View style={styles.titleStack}>
        <Text style={styles.chatHeaderTitle} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choose agent, ${runtimeLabel}, ${runtimeStatusLabel}`}
          onPress={onOpenRuntime}
          style={[styles.runtimeChip, !runtimeReady && styles.runtimeChipMuted]}
          hitSlop={hitSlop}
        >
          <View style={[styles.runtimeDot, runtimeReady ? styles.runtimeDotReady : styles.runtimeDotMuted]} />
          <Text style={styles.runtimeText} numberOfLines={1}>{runtimeLabel}</Text>
          <Text style={styles.runtimeStatus} numberOfLines={1}>{runtimeStatusLabel}</Text>
          <Ionicons name="chevron-down" size={12} color={colors.textSubtle} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="New conversation" onPress={onNewChat} style={styles.iconButton} hitSlop={hitSlop}>
        <Ionicons name="add-circle-outline" size={22} color={colors.amber} />
      </Pressable>
    </View>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    chatHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      borderBottomWidth: hairlineWidth,
      borderBottomColor: colors.borderSubtle,
      backgroundColor: colors.background,
    },
    iconButton: {
      minWidth: 40,
      minHeight: 40,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleStack: {
      flex: 1,
      alignItems: 'center',
      gap: 5,
    },
    chatHeaderTitle: {
      textAlign: 'center',
      fontSize: typography.bodyLarge,
      fontWeight: '600',
      color: colors.text,
    },
    runtimeChip: {
      maxWidth: '92%',
      minHeight: 26,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surfaceMuted,
    },
    runtimeChipMuted: {
      opacity: 0.75,
    },
    runtimeDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    runtimeDotReady: {
      backgroundColor: colors.success,
    },
    runtimeDotMuted: {
      backgroundColor: colors.textSubtle,
    },
    runtimeText: {
      maxWidth: 110,
      fontSize: typography.caption,
      fontWeight: '700',
      color: colors.textMuted,
    },
    runtimeStatus: {
      maxWidth: 70,
      fontSize: 11,
      color: colors.textSubtle,
    },
  });
  return { styles };
}
