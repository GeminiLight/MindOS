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
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { mindosClient } from '@/lib/api-client';
import type { SearchResult } from '@/lib/types';

const DEBOUNCE_MS = 400;

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const data = await mindosClient.search(q.trim());
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on typing
  const handleChangeText = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length >= 2) {
      debounceRef.current = setTimeout(() => doSearch(text), DEBOUNCE_MS);
    } else if (!text.trim()) {
      setResults([]);
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
    if (!query.trim()) return <Text style={styles.resultSnippet}>{snippet}</Text>;
    const idx = snippet.toLowerCase().indexOf(query.trim().toLowerCase());
    if (idx === -1) return <Text style={styles.resultSnippet} numberOfLines={2}>{snippet}</Text>;
    const before = snippet.slice(0, idx);
    const match = snippet.slice(idx, idx + query.trim().length);
    const after = snippet.slice(idx + query.trim().length);
    return (
      <Text style={styles.resultSnippet} numberOfLines={2}>
        {before}<Text style={styles.highlight}>{match}</Text>{after}
      </Text>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#78716c" />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleChangeText}
          placeholder="Search your knowledge base..."
          placeholderTextColor="#78716c"
          returnKeyType="search"
          onSubmitEditing={handleSubmit}
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => { setQuery(''); setResults([]); setSearched(false); }} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#78716c" />
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color="#c8873a" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.path}
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <Pressable
              style={styles.resultRow}
              onPress={() => router.push(`/view/${item.path}` as any)}
            >
              <Text style={styles.resultPath} numberOfLines={1}>{item.path}</Text>
              {renderSnippet(item.snippet)}
            </Pressable>
          )}
          ListEmptyComponent={
            searched ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={48} color="#44403c" />
                <Text style={styles.emptyText}>No results found for "{query}"</Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={48} color="#44403c" />
                <Text style={styles.emptyText}>Search across all your notes</Text>
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#292524',
    borderRadius: 10,
    margin: 16,
    paddingHorizontal: 12,
    gap: 8,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 16, color: '#fafaf9' },
  resultRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  resultPath: { fontSize: 13, color: '#c8873a', marginBottom: 4 },
  resultSnippet: { fontSize: 14, color: '#d6d3d1', lineHeight: 20 },
  highlight: { color: '#c8873a', fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: '#78716c', textAlign: 'center', paddingHorizontal: 32 },
});
