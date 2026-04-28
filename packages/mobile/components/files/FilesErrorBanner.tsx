import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FilesBannerState } from '@/lib/files-tab-state';

interface FilesErrorBannerProps {
  banner: FilesBannerState;
  onRetry: () => void;
}

export default function FilesErrorBanner({ banner, onRetry }: FilesErrorBannerProps) {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Ionicons name="cloud-offline-outline" size={18} color="#fca5a5" />
        <View style={styles.copy}>
          <Text style={styles.title}>{banner.title}</Text>
          <Text style={styles.message}>{banner.message}</Text>
        </View>
      </View>
      {banner.showRetry ? (
        <Pressable style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    gap: 10,
  },
  content: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  copy: { flex: 1 },
  title: { fontSize: 13, fontWeight: '600', color: '#fecaca' },
  message: { fontSize: 12, color: '#fca5a5', marginTop: 2 },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#c8873a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
