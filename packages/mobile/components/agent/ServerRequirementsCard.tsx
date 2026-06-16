import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import MindButton from '@/components/ui/MindButton';
import MindCard from '@/components/ui/MindCard';
import StatusPill from '@/components/ui/StatusPill';
import {
  AGENT_SERVER_REQUIREMENTS,
  formatAgentServerRequirementsContract,
  summarizeAgentServerRequirements,
  type AgentServerRequirementId,
} from '@/lib/agent-server-requirements';
import { colors, hairlineWidth, radius, spacing, typography } from '@/lib/theme';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const REQUIREMENT_ICONS: Record<AgentServerRequirementId, IoniconsName> = {
  'agent-tasks': 'cloud-upload-outline',
  'runtime-permissions': 'shield-checkmark-outline',
  'user-questions': 'chatbubble-ellipses-outline',
  'native-sessions': 'albums-outline',
  'run-tree': 'git-network-outline',
};

export default function ServerRequirementsCard() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const contract = useMemo(() => formatAgentServerRequirementsContract(), []);
  const summary = useMemo(() => summarizeAgentServerRequirements(), []);

  useEffect(() => {
    if (copyState !== 'copied') return undefined;
    const timer = setTimeout(() => setCopyState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [copyState]);

  async function copyRequirements() {
    try {
      await Clipboard.setStringAsync(contract);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <MindCard>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <Ionicons name="server-outline" size={19} color={colors.amber} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Server Requirements</Text>
          <Text style={styles.subtitle}>
            Contracts needed before mobile can approve, answer, resume, or launch agent work.
          </Text>
        </View>
        <StatusPill label={`${summary.requirementCount} gaps`} tone="warning" />
      </View>

      <View style={styles.metricRow}>
        <Metric label="Endpoints" value={summary.endpointCount} />
        <Metric label="Capabilities" value={summary.capabilityCount} />
      </View>

      <View style={styles.list}>
        {AGENT_SERVER_REQUIREMENTS.map((requirement, index) => (
          <View
            key={requirement.id}
            style={[styles.row, index < AGENT_SERVER_REQUIREMENTS.length - 1 && styles.rowBorder]}
          >
            <View style={styles.rowIcon}>
              <Ionicons name={REQUIREMENT_ICONS[requirement.id]} size={16} color={colors.textMuted} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{requirement.title}</Text>
              <Text style={styles.rowSummary}>{requirement.summary}</Text>
              <Text style={styles.rowUnlocks}>{requirement.unlocks}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footerRow}>
        <Text style={[styles.footerText, copyState === 'error' && styles.footerError]}>
          {copyState === 'copied'
            ? 'Requirements copied'
            : copyState === 'error'
              ? 'Clipboard unavailable. Try again from a supported device.'
              : 'Mobile stays a control surface until these server contracts exist.'}
        </Text>
        <MindButton
          label={copyState === 'copied' ? 'Copied' : 'Copy contract'}
          icon={copyState === 'copied' ? 'checkmark-outline' : 'copy-outline'}
          variant="secondary"
          onPress={copyRequirements}
          style={styles.copyButton}
        />
      </View>
    </MindCard>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textMuted,
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
    minHeight: 58,
    justifyContent: 'center',
    gap: spacing.xs / 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  metricValue: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  metricLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textSubtle,
  },
  list: {
    borderTopWidth: hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowBorder: {
    borderBottomWidth: hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  rowCopy: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  rowTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  rowSummary: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textMuted,
  },
  rowUnlocks: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textSubtle,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  footerText: {
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textSubtle,
  },
  footerError: {
    color: colors.warning,
  },
  copyButton: {
    minWidth: 126,
  },
});
