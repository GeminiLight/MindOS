/**
 * Breadcrumb — horizontal scrollable path navigation for Files tab.
 */
import { useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, hairlineWidth, hitSlop, radius, spacing, typography } from '@/lib/theme';

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
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
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
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Open file root"
        >
          <Ionicons name="home-outline" size={14} color={segments.length === 0 ? colors.amber : colors.textMuted} />
          <Text style={[styles.segmentText, segments.length === 0 && styles.segmentTextActive]}>
            Files
          </Text>
        </Pressable>

        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <View key={seg.path} style={styles.segmentRow}>
              <Ionicons name="chevron-forward" size={12} color={colors.textSubtle} />
              <Pressable
                style={styles.segment}
                onPress={() => onNavigate(seg.path)}
                hitSlop={hitSlop}
                accessibilityRole="button"
                accessibilityLabel={`Open ${seg.path}`}
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
    borderBottomWidth: hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  scroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  segmentText: {
    fontSize: typography.caption,
    color: colors.textMuted,
    maxWidth: 120,
  },
  segmentTextActive: {
    color: colors.amber,
    fontWeight: '600',
  },
});
