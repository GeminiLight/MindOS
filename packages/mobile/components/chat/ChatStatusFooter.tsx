import { Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MindButton from '@/components/ui/MindButton';
import MindCard from '@/components/ui/MindCard';
import { colors, spacing, typography } from '@/lib/theme';

interface ChatStatusFooterProps {
  isStreaming: boolean;
  hasAssistantContent: boolean;
  error: string;
  canRetry: boolean;
  onRetry: () => void;
}

export default function ChatStatusFooter({
  isStreaming,
  hasAssistantContent,
  error,
  canRetry,
  onRetry,
}: ChatStatusFooterProps) {
  return (
    <>
      {isStreaming && !hasAssistantContent ? (
        <MindCard style={styles.thinkingBox}>
          <ActivityIndicator color={colors.amber} size="small" />
          <Text style={styles.thinkingText}>Thinking...</Text>
        </MindCard>
      ) : null}
      {error ? (
        <MindCard tone="error" style={styles.errorBox}>
          <Ionicons name="warning-outline" size={14} color={colors.errorText} />
          <Text style={styles.errorText} numberOfLines={3}>{error}</Text>
          {canRetry ? (
            <MindButton
              label="Retry"
              icon="refresh-outline"
              variant="secondary"
              onPress={onRetry}
              style={styles.retryBtn}
            />
          ) : null}
        </MindCard>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  thinkingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.amberSoft,
    borderColor: colors.amberBorder,
  },
  thinkingText: {
    fontSize: typography.caption,
    color: colors.amber,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingVertical: spacing.md,
  },
  errorText: {
    fontSize: typography.caption,
    color: colors.errorText,
    flex: 1,
    lineHeight: 18,
  },
  retryBtn: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
});
