/**
 * Settings tab — connection management + app info.
 */
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useConnectionStore } from '@/lib/connection-store';
import {
  formatConnectionDiagnostic,
  formatLastCheckedAt,
} from '@/lib/connection-diagnostics';
import MindButton from '@/components/ui/MindButton';
import MindCard from '@/components/ui/MindCard';
import StatusPill from '@/components/ui/StatusPill';
import AgentRuntimeOverview from '@/components/agent/AgentRuntimeOverview';
import { useAgentRuntimes } from '@/hooks/useAgentRuntimes';
import { colors, spacing, typography } from '@/lib/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const {
    status,
    serverUrl,
    serverVersion,
    hostname,
    hasAuthToken,
    diagnostic,
    lastCheckedAt,
    disconnect,
    checkHealth,
  } = useConnectionStore();

  const isChecking = status === 'connecting';
  const agentRuntimeState = useAgentRuntimes({ enabled: status === 'connected' });
  const formattedError = status === 'error' ? formatConnectionDiagnostic(diagnostic) : null;
  const statusTone = status === 'connected' ? 'success'
    : status === 'connecting' ? 'warning'
      : status === 'error' ? 'error'
        : 'muted';
  const statusLabel = status === 'connected' ? 'Connected'
    : status === 'connecting' ? 'Checking'
      : status === 'error' ? 'Needs attention'
        : 'Disconnected';

  async function handleDisconnect() {
    Alert.alert(
      'Disconnect',
      'Disconnect this mobile device from the current MindOS server?',
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
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Connection</Text>
            <StatusPill label={statusLabel} tone={statusTone} />
          </View>

          <MindCard>
            {serverUrl ? (
              <>
                <InfoRow label="Server" value={serverUrl} />
                <InfoRow label="Version" value={serverVersion || 'Unknown'} />
                {hostname ? <InfoRow label="Host" value={hostname} /> : null}
                <InfoRow label="Access" value={hasAuthToken ? 'Token protected' : 'Local network'} />
                <InfoRow label="Last check" value={formatLastCheckedAt(lastCheckedAt)} />
              </>
            ) : (
              <View style={styles.emptyConnection}>
                <Ionicons name="unlink-outline" size={22} color={colors.textSubtle} />
                <Text style={styles.emptyText}>No server connected</Text>
              </View>
            )}

            {formattedError ? (
              <View style={styles.errorRow}>
                <Ionicons name="warning-outline" size={16} color={colors.errorText} />
                <View style={styles.errorCopy}>
                  <Text style={styles.errorTitle}>{formattedError.title}</Text>
                  <Text style={styles.errorText}>{formattedError.message}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.actions}>
              <MindButton
                label={isChecking ? 'Checking' : 'Retry'}
                icon="refresh"
                variant="secondary"
                loading={isChecking}
                disabled={isChecking}
                onPress={() => { void checkHealth(); }}
                style={styles.actionButton}
              />
              <MindButton
                label="Change"
                icon="swap-horizontal-outline"
                variant="ghost"
                onPress={() => router.push('/connect')}
                style={styles.actionButton}
              />
              {serverUrl ? (
                <MindButton
                  label="Disconnect"
                  icon="log-out-outline"
                  variant="danger"
                  onPress={() => { void handleDisconnect(); }}
                  style={styles.actionButton}
                />
              ) : null}
            </View>
          </MindCard>
        </View>

        <View style={styles.section}>
          <AgentRuntimeOverview
            summary={agentRuntimeState.summary}
            loading={agentRuntimeState.loading}
            refreshing={agentRuntimeState.refreshing}
            error={agentRuntimeState.error}
            lastCheckedAt={agentRuntimeState.lastCheckedAt}
            onRefresh={agentRuntimeState.refresh}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.sectionTitleStandalone]}>About</Text>
          <MindCard>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLogo}>◆</Text>
              <View style={styles.aboutCopy}>
                <Text style={styles.aboutName}>MindOS Mobile</Text>
                <Text style={styles.aboutVersion}>v{Constants.expoConfig?.version ?? '0.1.0'}</Text>
              </View>
            </View>
            <Text style={styles.aboutText}>
              Capture, search, read, and chat with your local MindOS workspace from your phone.
            </Text>
          </MindCard>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.section,
    fontWeight: '700',
    color: colors.text,
  },
  sectionTitleStandalone: {
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  infoLabel: {
    fontSize: typography.body,
    color: colors.textSubtle,
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: typography.body,
    color: colors.textMuted,
  },
  emptyConnection: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  errorCopy: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  errorTitle: {
    color: colors.errorText,
    fontSize: typography.body,
    fontWeight: '700',
  },
  errorText: {
    color: colors.errorText,
    fontSize: typography.body,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  actionButton: {
    flexGrow: 1,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  aboutLogo: {
    fontSize: 24,
    color: colors.amber,
  },
  aboutCopy: {
    flex: 1,
  },
  aboutName: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  aboutVersion: {
    fontSize: typography.caption,
    color: colors.textSubtle,
    marginTop: 2,
  },
  aboutText: {
    fontSize: typography.body,
    color: colors.textMuted,
    lineHeight: 21,
  },
});
