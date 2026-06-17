/**
 * Search tab — full-text search with debounce and keyboard dismiss.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  EmptyState,
  MindScreen,
} from '@/components/ui/MobileScaffold';
import { mindosClient } from '@/lib/api-client';
import {
  canRunSearch,
  getNormalizedSearchQuery,
  getSearchEmptyState,
  getSearchErrorMessage,
} from '@/lib/search-state';
import { viewFileHref } from '@/lib/mobile-navigation';
import { colors, hairlineWidth, hitSlop, radius, spacing, typography } from '@/lib/theme';
import type { SearchResult } from '@/lib/types';

const DEBOUNCE_MS = 400;

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    const normalized = getNormalizedSearchQuery(q);
    if (!canRunSearch(normalized)) {
      setResults([]);
      setError('');
      setSearched(Boolean(normalized));
      return;
    }

    setLoading(true);
    setSearched(true);
    setError('');
    try {
      const data = await mindosClient.search(normalized);
      setResults(data);
    } catch (e) {
      setResults([]);
      setError(getSearchErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on typing
  const handleChangeText = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (canRunSearch(text)) {
      debounceRef.current = setTimeout(() => doSearch(text), DEBOUNCE_MS);
    } else {
      setResults([]);
      setError('');
      setSearched(false);
    }
  }, [doSearch]);

  // Instant search on submit
  const handleSubmit = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSearch(query);
  }, [query, doSearch]);

  // Cleanup
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

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
                  onPress={() => {
                    setQuery('');
                    setResults([]);
                    setError('');
                    setSearched(false);
                  }}
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
              onAction={emptyState.actionLabel ? () => doSearch(query) : undefined}
              loading={loading}
            />
          ) : null
        }
      />
    </MindScreen>
  );
}

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
