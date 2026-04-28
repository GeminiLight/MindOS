import { View, Text, Pressable, StyleSheet } from 'react-native';

interface ChatEmptyStateProps {
  suggestions: string[];
  onPickSuggestion: (value: string) => void;
}

export default function ChatEmptyState({ suggestions, onPickSuggestion }: ChatEmptyStateProps) {
  return (
    <View style={styles.emptyCenter}>
      <Text style={styles.emptyIcon}>◆</Text>
      <Text style={styles.emptyTitle}>Ask MindOS</Text>
      <Text style={styles.emptySubtitle}>Ask anything about your knowledge base</Text>

      <View style={styles.suggestionsBox}>
        {suggestions.map((suggestion) => (
          <Pressable
            key={suggestion}
            style={styles.suggestionChip}
            onPress={() => onPickSuggestion(suggestion)}
          >
            <Text style={styles.suggestionText} numberOfLines={1}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyIcon: { fontSize: 32, color: '#c8873a', marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#fafaf9' },
  emptySubtitle: { fontSize: 14, color: '#a8a29e', textAlign: 'center' },
  suggestionsBox: { marginTop: 24, gap: 8, width: '100%' },
  suggestionChip: {
    backgroundColor: '#292524',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#44403c',
  },
  suggestionText: { fontSize: 14, color: '#d6d3d1' },
});