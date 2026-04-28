/**
 * Settings tab — connection management + app info.
 */
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useConnectionStore } from '@/lib/connection-store';

export default function SettingsScreen() {
  const router = useRouter();
  const { status, serverUrl, serverVersion, hostname, disconnect, checkHealth } =
    useConnectionStore();

  const isChecking = status === 'connecting';

  async function handleDisconnect() {
    Alert.alert(
      'Disconnect',
      'Are you sure you want to disconnect from this MindOS server?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnect();
            router.replace('/connect');
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={[styles.dot, status === 'connected' ? styles.dotGreen : status === 'connecting' ? styles.dotYellow : null]} />
            <Text style={styles.label}>
              {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Checking...' : status === 'error' ? 'Error' : 'Disconnected'}
            </Text>
          </View>

          {serverUrl ? (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Server</Text>
                <Text style={styles.infoValue} numberOfLines={1}>{serverUrl}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Version</Text>
                <Text style={styles.infoValue}>{serverVersion || '—'}</Text>
              </View>
              {hostname ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Host</Text>
                  <Text style={styles.infoValue}>{hostname}</Text>
                </View>
              ) : null}
            </>
          ) : null}

          <View style={styles.actions}>
            <Pressable style={styles.actionButton} onPress={checkHealth} disabled={isChecking}>
              {isChecking ? (
                <ActivityIndicator size="small" color="#c8873a" />
              ) : (
                <Ionicons name="refresh" size={16} color="#c8873a" />
              )}
              <Text style={styles.actionText}>{isChecking ? 'Checking...' : 'Check Connection'}</Text>
            </Pressable>

            {serverUrl ? (
              <Pressable style={styles.actionButtonDanger} onPress={handleDisconnect}>
                <Ionicons name="log-out-outline" size={16} color="#ef4444" />
                <Text style={styles.actionTextDanger}>Disconnect</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.aboutLogo}>◆</Text>
            <View>
              <Text style={styles.aboutName}>MindOS Mobile</Text>
              <Text style={styles.aboutVersion}>v{Constants.expoConfig?.version ?? '0.1.0'}</Text>
            </View>
          </View>
          <Text style={styles.aboutText}>
            Human-Agent Collaborative Mind System
          </Text>
          <View style={styles.featureList}>
            <FeatureRow icon="folder-outline" text="Browse & search your knowledge base" />
            <FeatureRow icon="chatbubble-outline" text="AI Chat with streaming responses" />
            <FeatureRow icon="create-outline" text="Markdown editor with toolbar" />
            <FeatureRow icon="cloud-upload-outline" text="Conflict detection on save" />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function FeatureRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureRow}>
      <Ionicons name={icon as any} size={16} color="#c8873a" />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  section: { paddingHorizontal: 16, paddingTop: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#fafaf9', marginBottom: 12 },
  card: {
    backgroundColor: '#292524',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#44403c',
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#78716c' },
  dotGreen: { backgroundColor: '#22c55e' },
  dotYellow: { backgroundColor: '#eab308' },
  label: { fontSize: 15, fontWeight: '600', color: '#fafaf9' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 13, color: '#78716c' },
  infoValue: { fontSize: 13, color: '#d6d3d1', flex: 1, textAlign: 'right', marginLeft: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(200, 135, 58, 0.1)',
  },
  actionText: { fontSize: 13, color: '#c8873a', fontWeight: '500' },
  actionButtonDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  actionTextDanger: { fontSize: 13, color: '#ef4444', fontWeight: '500' },
  aboutText: { fontSize: 14, color: '#a8a29e', lineHeight: 22 },
  aboutLogo: { fontSize: 24, color: '#c8873a', marginRight: 8 },
  aboutName: { fontSize: 16, fontWeight: '700', color: '#fafaf9' },
  aboutVersion: { fontSize: 12, color: '#78716c' },
  featureList: { gap: 8, marginTop: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontSize: 13, color: '#a8a29e' },
});
