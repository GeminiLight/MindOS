/**
 * OfflineBanner — Shows a persistent warning when server connection is lost.
 * Place at the top of tab screens.
 */
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useConnectionStore } from '@/lib/connection-store';

export default function OfflineBanner() {
  const status = useConnectionStore((s) => s.status);
  const checkHealth = useConnectionStore((s) => s.checkHealth);

  if (status === 'connected' || status === 'disconnected') return null;

  const isChecking = status === 'connecting';

  return (
    <View style={styles.banner}>
      {isChecking ? (
        <ActivityIndicator size={12} color="#eab308" />
      ) : (
        <Ionicons name="cloud-offline-outline" size={14} color="#eab308" />
      )}
      <Text style={styles.text}>
        {isChecking ? 'Reconnecting...' : 'Connection lost'}
      </Text>
      {!isChecking && (
        <Pressable onPress={checkHealth} style={styles.retryBtn} hitSlop={8}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(234, 179, 8, 0.3)',
  },
  text: {
    flex: 1,
    fontSize: 12,
    color: '#eab308',
    fontWeight: '500',
  },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(234, 179, 8, 0.2)',
  },
  retryText: {
    fontSize: 12,
    color: '#eab308',
    fontWeight: '600',
  },
});
