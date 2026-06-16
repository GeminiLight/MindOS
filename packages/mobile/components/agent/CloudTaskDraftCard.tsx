import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import MindCard from '@/components/ui/MindCard';
import MindButton from '@/components/ui/MindButton';
import StatusPill from '@/components/ui/StatusPill';
import {
  AGENT_TASK_PROVIDER_OPTIONS,
  formatAgentTaskDraftContract,
  getAgentTaskProvider,
  validateAgentTaskDraft,
  type AgentTaskProviderId,
} from '@/lib/agent-task-draft';
import { useAgentTaskDraft } from '@/hooks/useAgentTaskDraft';
import { colors, hairlineWidth, radius, spacing, typography } from '@/lib/theme';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const PROVIDER_ICONS: Record<AgentTaskProviderId, IoniconsName> = {
  'codex-cloud': 'terminal-outline',
  'claude-code-web': 'code-slash-outline',
  'github-copilot': 'git-pull-request-outline',
};

export default function CloudTaskDraftCard() {
  const { draft, loaded, saveStatus, saveError, updateDraft, resetDraft } = useAgentTaskDraft();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const provider = getAgentTaskProvider(draft.provider);
  const validation = useMemo(() => validateAgentTaskDraft(draft), [draft]);
  const contractPreview = useMemo(() => formatAgentTaskDraftContract(draft), [draft]);
  const storagePill = getStoragePill({ loaded, saveStatus, saveError });

  useEffect(() => {
    if (copyState !== 'copied') return undefined;
    const timer = setTimeout(() => setCopyState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [copyState]);

  async function copyContract() {
    try {
      await Clipboard.setStringAsync(contractPreview);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <MindCard>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <Ionicons name="cloud-upload-outline" size={19} color={colors.amber} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Cloud Task Draft</Text>
          <Text style={styles.subtitle}>
            Prepare a cloud task payload for a future Product Server adapter.
          </Text>
        </View>
        <StatusPill label={storagePill.label} tone={storagePill.tone} />
      </View>

      <View style={styles.providerRow}>
        {AGENT_TASK_PROVIDER_OPTIONS.map((option) => {
          const selected = option.id === draft.provider;
          return (
            <Pressable
              key={option.id}
              onPress={() => updateDraft({ provider: option.id })}
              style={[styles.providerChip, selected && styles.providerChipSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Ionicons
                name={PROVIDER_ICONS[option.id]}
                size={15}
                color={selected ? colors.amber : colors.textMuted}
              />
              <Text style={[styles.providerText, selected && styles.providerTextSelected]}>
                {option.shortName}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.form}>
        <Field
          label={draft.provider === 'claude-code-web' ? 'Workspace or repo' : 'Repository'}
          value={draft.repo ?? ''}
          placeholder={draft.provider === 'claude-code-web' ? 'Local workspace or GitHub repo' : 'owner/repo'}
          onChangeText={(repo) => updateDraft({ repo })}
        />
        <Field
          label="Branch"
          value={draft.branch ?? ''}
          placeholder="optional target branch"
          onChangeText={(branch) => updateDraft({ branch })}
        />
        <Field
          label="Project path"
          value={draft.projectPath ?? ''}
          placeholder="optional workspace path"
          onChangeText={(projectPath) => updateDraft({ projectPath })}
        />
        <View style={styles.field}>
          <View style={styles.promptLabelRow}>
            <Text style={styles.label}>Task prompt</Text>
            <Pressable
              onPress={resetDraft}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Reset cloud task draft"
              style={styles.resetButton}
            >
              <Ionicons name="refresh-outline" size={14} color={colors.textSubtle} />
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.input, styles.promptInput]}
            value={draft.prompt}
            placeholder="Describe what the agent should do"
            placeholderTextColor={colors.textSubtle}
            onChangeText={(prompt) => updateDraft({ prompt })}
            multiline
            textAlignVertical="top"
          />
        </View>
      </View>

      <View style={styles.contractBox}>
        <View style={styles.contractHeader}>
          <Text style={styles.contractTitle}>{provider.name}</Text>
          <Text style={styles.contractStatus}>{provider.statusLabel}</Text>
        </View>
        <Text style={styles.contractHint}>{provider.contractHint}</Text>
        <Text style={styles.contractPreview} numberOfLines={5} selectable>
          {contractPreview}
        </Text>
      </View>

      <View style={styles.footerRow}>
        <View style={styles.footerCopy}>
          <Text style={[styles.footerTitle, validation.ok && styles.footerTitleReady]}>
            {copyState === 'copied' ? 'Contract copied' : validation.ok ? 'Draft complete' : 'Draft incomplete'}
          </Text>
          <Text style={[styles.footerText, copyState === 'error' && styles.footerTextError]}>
            {copyState === 'error'
              ? 'Clipboard unavailable. Long-press the JSON preview if needed.'
              : saveError
                ? 'Saved draft could not be updated locally.'
                : validation.message}
          </Text>
        </View>
        <View style={styles.footerActions}>
          <MindButton
            label={copyState === 'copied' ? 'Copied' : 'Copy JSON'}
            icon={copyState === 'copied' ? 'checkmark-outline' : 'copy-outline'}
            variant="secondary"
            onPress={copyContract}
            disabled={!loaded}
            style={styles.actionButton}
          />
          <MindButton
            label="Needs server"
            icon="lock-closed-outline"
            variant="ghost"
            disabled
            style={styles.actionButton}
          />
        </View>
      </View>
    </MindCard>
  );
}

function getStoragePill({
  loaded,
  saveStatus,
  saveError,
}: {
  loaded: boolean;
  saveStatus: 'loading' | 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
}): { label: string; tone: ComponentProps<typeof StatusPill>['tone'] } {
  if (!loaded || saveStatus === 'loading') return { label: 'Loading', tone: 'muted' };
  if (saveStatus === 'saving') return { label: 'Saving', tone: 'muted' };
  if (saveStatus === 'error' || saveError) return { label: 'Save issue', tone: 'warning' };
  return { label: 'Saved local', tone: 'success' };
}

function Field({
  label,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
      />
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
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  providerChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  providerChipSelected: {
    borderColor: colors.amberBorder,
    backgroundColor: colors.amberSoft,
  },
  providerText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
  },
  providerTextSelected: {
    color: colors.amber,
  },
  form: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
  },
  promptLabelRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs / 2,
  },
  resetText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textSubtle,
  },
  input: {
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    fontSize: typography.body,
  },
  promptInput: {
    minHeight: 92,
    lineHeight: 20,
  },
  contractBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  contractHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  contractTitle: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  contractStatus: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textSubtle,
  },
  contractHint: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textMuted,
  },
  contractPreview: {
    paddingTop: spacing.sm,
    borderTopWidth: hairlineWidth,
    borderTopColor: colors.border,
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textSubtle,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  footerCopy: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  footerTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.textMuted,
  },
  footerTitleReady: {
    color: colors.success,
  },
  footerText: {
    fontSize: typography.caption,
    lineHeight: 17,
    color: colors.textSubtle,
  },
  footerTextError: {
    color: colors.warning,
  },
  footerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 108,
  },
});
