import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { mindosClient } from '@/lib/api-client';
import type { AgentRunCapsuleProjection, AgentRunCapsuleRecoveryAction } from '@/lib/types';
import { colors, minTouchTarget, radius, spacing, typography } from '@/lib/theme';

const ACTIONS: Array<{
  action: Exclude<AgentRunCapsuleRecoveryAction, 'rollback'>;
  label: string;
}> = [
  { action: 'retry', label: 'Retry' },
  { action: 'fork', label: 'Fork' },
  { action: 'resume', label: 'Resume' },
];

export default function RunRecoveryControls({
  capsule,
  onStarted,
}: {
  capsule: AgentRunCapsuleProjection;
  onStarted(): void;
}) {
  const [working, setWorking] = useState<AgentRunCapsuleRecoveryAction | null>(null);
  const [message, setMessage] = useState('');
  const [hostPath, setHostPath] = useState('');

  const recover = async (action: Exclude<AgentRunCapsuleRecoveryAction, 'rollback'>) => {
    if (working) return;
    setWorking(action);
    setMessage('');
    setHostPath('');
    try {
      const result = await mindosClient.recoverAgentRunCapsule(capsule.id, action);
      setMessage('Recovery started on the connected host.');
      setHostPath(`/chat/${encodeURIComponent(result.chatSessionId)}`);
      onStarted();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Recovery could not be started.');
    } finally {
      setWorking(null);
    }
  };

  const blocker = capsule.recovery.resume.supported
    ? capsule.recovery.rollback.reason
    : capsule.recovery.resume.reason ?? capsule.recovery.rollback.reason;

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        {ACTIONS.map(({ action, label }) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            accessibilityLabel={`${label} agent run`}
            accessibilityState={{ disabled: Boolean(working) || !capsule.recovery[action].supported }}
            disabled={Boolean(working) || !capsule.recovery[action].supported}
            onPress={() => void recover(action)}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.pressed,
              (Boolean(working) || !capsule.recovery[action].supported) && styles.disabled,
            ]}
          >
            <Text style={styles.buttonText}>{working === action ? 'Starting…' : label}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={[styles.button, styles.disabled]}>
          <Text style={styles.buttonText}>Rollback</Text>
        </Pressable>
      </View>
      {blocker ? <Text style={styles.reason}>{blocker}</Text> : null}
      {message ? <Text accessibilityRole="text" style={styles.message}>{message}</Text> : null}
      {hostPath ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${mindosClient.baseUrl}${hostPath}`)}>
          <Text style={styles.hostLink}>Open on host</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, paddingBottom: spacing.md, paddingLeft: 42 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  button: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.amberBorder,
    backgroundColor: colors.amberSoft,
    paddingHorizontal: spacing.sm,
  },
  buttonText: { color: colors.amber, fontSize: typography.caption, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
  reason: { color: colors.textSubtle, fontSize: 11, lineHeight: 15 },
  message: { color: colors.textMuted, fontSize: typography.caption },
  hostLink: { color: colors.amber, fontSize: typography.caption, fontWeight: '700' },
});
