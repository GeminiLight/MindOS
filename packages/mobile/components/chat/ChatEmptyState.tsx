import { spacing, typography, useThemedStyles, type ThemeColors } from '@/lib/theme';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface ChatEmptyStateProps {
  title?: string;
  subtitle?: string;
  suggestions: string[];
  onPickSuggestion: (value: string) => void;
}

export default function ChatEmptyState({
  title = 'Ask MindOS',
  subtitle = 'Ask anything about your knowledge base',
  suggestions,
  onPickSuggestion,
}: ChatEmptyStateProps) {
  const { styles } = useThemedStyles(createViewTheme);
  return (
    <ScrollView contentContainerStyle={styles.emptyCenter} keyboardShouldPersistTaps="handled">
      <Text style={styles.emptyIcon}>◆</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>

      <View style={styles.suggestionsBox}>
        {suggestions.map((suggestion) => (
          <Pressable
            accessibilityRole="button"
            key={suggestion}
            style={styles.suggestionChip}
            onPress={() => onPickSuggestion(suggestion)}
          >
            <Text style={styles.suggestionText} numberOfLines={1}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    emptyCenter: {
      flexGrow: 1,
      paddingVertical: spacing.xl,
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: 32,
    },
    emptyIcon: { fontSize: 32, color: colors.amber, marginBottom: spacing.sm },
    emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
    emptySubtitle: {
      fontSize: typography.body,
      lineHeight: 20,
      color: colors.textMuted,
      textAlign: 'center',
    },
    suggestionsBox: { marginTop: spacing.xl, gap: spacing.sm, width: '100%' },
    suggestionChip: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    suggestionText: { fontSize: typography.body, color: colors.textMuted },
  });
  return { styles };
}
