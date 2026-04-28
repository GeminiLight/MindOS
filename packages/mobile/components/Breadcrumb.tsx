/**
 * Breadcrumb — horizontal scrollable path navigation for Files tab.
 */
import { useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface BreadcrumbProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

interface Segment {
  label: string;
  path: string;
}

function buildSegments(currentPath: string): Segment[] {
  if (!currentPath) return [];
  const parts = currentPath.split('/');
  return parts.map((part, i) => ({
    label: part,
    path: parts.slice(0, i + 1).join('/'),
  }));
}

export default function Breadcrumb({ currentPath, onNavigate }: BreadcrumbProps) {
  const scrollRef = useRef<ScrollView>(null);
  const segments = buildSegments(currentPath);

  useEffect(() => {
    // Auto-scroll to the end when path changes
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [currentPath]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Pressable
          style={styles.segment}
          onPress={() => onNavigate('')}
          hitSlop={8}
        >
          <Ionicons name="home-outline" size={14} color={segments.length === 0 ? '#c8873a' : '#a8a29e'} />
          <Text style={[styles.segmentText, segments.length === 0 && styles.segmentTextActive]}>
            Files
          </Text>
        </Pressable>

        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <View key={seg.path} style={styles.segmentRow}>
              <Ionicons name="chevron-forward" size={12} color="#57534e" />
              <Pressable
                style={styles.segment}
                onPress={() => onNavigate(seg.path)}
                hitSlop={8}
              >
                <Text
                  style={[styles.segmentText, isLast && styles.segmentTextActive]}
                  numberOfLines={1}
                >
                  {seg.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
    backgroundColor: '#1c1917',
  },
  scroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  segmentText: {
    fontSize: 13,
    color: '#a8a29e',
    maxWidth: 120,
  },
  segmentTextActive: {
    color: '#c8873a',
    fontWeight: '600',
  },
});
