import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * Search tab — full-text search with debounce and keyboard dismiss.
 */
import {
  EmptyState,
  MindScreen,
} from '@/components/ui/MobileScaffold';
import { useSearch } from '@/hooks/useSearch';
import { viewFileHref } from '@/lib/mobile-navigation';
import {
  getNormalizedSearchQuery,
  getSearchEmptyState,
} from '@/lib/search-state';
import { hairlineWidth, hitSlop, radius, spacing, typography } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export default function SearchScreen() {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const router = useRouter();
  const { query, results, loading, searched, error, changeQuery: handleChangeText, submit: handleSubmit } = useSearch();

  /** Highlight query match in snippet */
  function renderSnippet(snippet: string) {
    const normalized = getNormalizedSearchQuery(query);
    if (!normalized) return <Text style={styles.resultSnippet}>{snippet}</Text>;
    const idx = snippet.toLowerCase().indexOf(normalized.toLowerCase());
    if (idx === -1) return <Text style={styles.resultSnippet} numberOfLines={2}>{snippet}</Text>;
    const before = snippet.slice(0, idx);
    const match = snippet.slice(idx, idx + normalized.length);
    const after = snippet.slice(idx + normalized.length);
    return (
      <Text style={styles.resultSnippet} numberOfLines={2}>
        {before}<Text style={styles.highlight}>{match}</Text>{after}
      </Text>
    );
  }

  const emptyState = getSearchEmptyState({
    query,
    searched,
    loading,
    resultCount: results.length,
    error,
  });

  return (
    <MindScreen>
      <FlatList
        data={results}
        keyExtractor={(item) => item.path}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={colors.textSubtle} />
              <TextInput
                style={styles.input}
                accessibilityLabel="Search your notes"
                value={query}
                onChangeText={handleChangeText}
                placeholder="Search notes, files, or phrases"
                placeholderTextColor={colors.textSubtle}
                returnKeyType="search"
                onSubmitEditing={handleSubmit}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {loading ? (
                <Ionicons name="sync-outline" size={18} color={colors.amber} />
              ) : query.length > 0 ? (
                <Pressable
                  onPress={() => handleChangeText('')}
                  hitSlop={hitSlop}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={18} color={colors.textSubtle} />
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
            onPress={() => router.push(viewFileHref(item.path))}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.path}`}
          >
            <View style={styles.resultIcon}>
              <Ionicons name="document-text-outline" size={18} color={colors.amber} />
            </View>
            <View style={styles.resultCopy}>
              <Text style={styles.resultPath} numberOfLines={1}>{item.path}</Text>
              {renderSnippet(item.snippet)}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          emptyState ? (
            <EmptyState
              icon={emptyState.icon}
              title={emptyState.title}
              message={emptyState.message}
              actionLabel={emptyState.actionLabel}
              onAction={emptyState.actionLabel ? handleSubmit : undefined}
              loading={loading}
            />
          ) : null
        }
      />
    </MindScreen>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      gap: spacing.md,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      minHeight: 48,
      gap: spacing.sm,
    },
    input: {
      flex: 1,
      paddingVertical: spacing.md,
      fontSize: typography.bodyLarge,
      color: colors.text,
    },
    resultRow: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    resultRowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    resultIcon: {
      width: 30,
      height: 30,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.amberSoft,
      marginTop: 2,
    },
    resultCopy: {
      flex: 1,
      minWidth: 0,
    },
    resultPath: {
      fontSize: typography.caption,
      color: colors.amber,
      marginBottom: spacing.xs,
      fontWeight: '700',
    },
    resultSnippet: {
      fontSize: typography.body,
      color: colors.textMuted,
      lineHeight: 20,
    },
    highlight: {
      color: colors.amber,
      fontWeight: '700',
    },
  });
  return { styles };
}
