import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import MindButton from '@/components/ui/MindButton';
import { usePendingAgentActions } from '@/hooks/usePendingAgentActions';
import { useConnectionStore } from '@/lib/connection-store';
import {
  buildAskUserQuestionAnswers,
  pendingAgentActionKey,
  type AskUserQuestionDraft,
} from '@/lib/pending-agent-actions';
import type { PendingAskUserQuestion, PendingRuntimePermission } from '@/lib/types';
import { colors, hairlineWidth, hitSlop, radius, shadows, spacing, typography } from '@/lib/theme';

export default function PendingAgentActionSheet() {
  const connected = useConnectionStore((state) => state.status === 'connected');
  const pending = usePendingAgentActions({ enabled: connected });
  const action = pending.actions[0];
  const actionKey = action ? pendingAgentActionKey(action) : null;
  const [visible, setVisible] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, AskUserQuestionDraft>>({});
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    setDrafts({});
    setValidationError('');
    if (!actionKey) {
      setVisible(false);
      return;
    }
    if (actionKey !== dismissedKey) setVisible(true);
  }, [actionKey, dismissedKey]);

  if (!connected || !action) return null;

  const resolving = pending.resolvingKey === actionKey;
  const close = () => {
    setDismissedKey(actionKey);
    setVisible(false);
  };

  async function submitQuestion(questionAction: PendingAskUserQuestion) {
    const result = buildAskUserQuestionAnswers(questionAction, drafts);
    if (!result.ok) {
      setValidationError(result.error);
      return;
    }
    setValidationError('');
    if (await pending.answerQuestion(questionAction, result.answers)) {
      setDismissedKey(null);
    }
  }

  return (
    <>
      <Pressable
        style={styles.floatingButton}
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`${pending.pendingCount} pending agent ${pending.pendingCount === 1 ? 'action' : 'actions'}`}
      >
        <Ionicons name="shield-checkmark-outline" size={20} color={colors.white} />
        <Text style={styles.floatingLabel}>{pending.pendingCount}</Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close agent action sheet" />
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Ionicons
                  name={action.kind === 'runtime-permission' ? 'shield-checkmark-outline' : 'chatbubble-ellipses-outline'}
                  size={19}
                  color={colors.amber}
                />
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>Agent action · 1 of {pending.pendingCount}</Text>
                <Text style={styles.title}>
                  {action.kind === 'runtime-permission' ? 'Permission requested' : 'Agent needs your answer'}
                </Text>
              </View>
              <Pressable onPress={close} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close-outline" size={24} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              {action.kind === 'runtime-permission' ? (
                <PermissionAction
                  action={action}
                  disabled={resolving}
                  onDecision={(decision) => void pending.resolvePermission(action, decision)}
                />
              ) : (
                <QuestionAction
                  action={action}
                  drafts={drafts}
                  disabled={resolving}
                  onDraftsChange={(next) => {
                    setDrafts(next);
                    setValidationError('');
                  }}
                  onSubmit={() => void submitQuestion(action)}
                  onCancel={() => void pending.cancelQuestion(action)}
                />
              )}

              {validationError || pending.error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="warning-outline" size={17} color={colors.errorText} />
                  <Text style={styles.errorText}>{validationError || pending.error}</Text>
                </View>
              ) : null}

              <Text style={styles.ownershipNote}>
                Decision is enforced by the connected runtime host. Mobile is an authorization surface.
              </Text>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function PermissionAction({
  action,
  disabled,
  onDecision,
}: {
  action: PendingRuntimePermission;
  disabled: boolean;
  onDecision(decision: string): void;
}) {
  const input = useMemo(() => formatInput(action.input), [action.input]);
  return (
    <View style={styles.actionBody}>
      <View style={styles.metaRow}>
        <Text style={styles.runtimeLabel}>{action.runtime.toUpperCase()}</Text>
        <Text style={[styles.riskLabel, action.risk.level === 'high' && styles.riskHigh]}>
          {action.risk.level} risk
        </Text>
      </View>
      <Text style={styles.prompt}>{action.risk.summary}</Text>
      <View style={styles.detailBox}>
        <Detail label="Action" value={action.action} />
        <Detail label="Tool" value={action.toolName} />
        {action.resource ? <Detail label="Resource" value={action.resource} /> : null}
        {input ? <Detail label="Input" value={input} /> : null}
      </View>
      <View style={styles.buttonStack}>
        {action.options.map((option) => (
          <MindButton
            key={option.id}
            label={option.label}
            variant={option.intent === 'deny' || option.intent === 'cancel'
              ? 'danger'
              : option.intent === 'allow' ? 'primary' : 'secondary'}
            disabled={disabled}
            onPress={() => onDecision(option.id)}
          />
        ))}
        {action.options.length === 0 ? (
          <Text style={styles.emptyOptions}>The runtime did not provide a valid decision option.</Text>
        ) : null}
      </View>
    </View>
  );
}

function QuestionAction({
  action,
  drafts,
  disabled,
  onDraftsChange,
  onSubmit,
  onCancel,
}: {
  action: PendingAskUserQuestion;
  drafts: Record<number, AskUserQuestionDraft>;
  disabled: boolean;
  onDraftsChange(next: Record<number, AskUserQuestionDraft>): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  function toggleOption(questionIndex: number, label: string, multiSelect: boolean) {
    const current = drafts[questionIndex]?.selected ?? [];
    const selected = multiSelect
      ? current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
      : [label];
    onDraftsChange({ ...drafts, [questionIndex]: { selected, custom: '' } });
  }

  return (
    <View style={styles.actionBody}>
      {action.questions.map((question, questionIndex) => {
        const draft = drafts[questionIndex] ?? {};
        return (
          <View key={`${questionIndex}:${question.question}`} style={styles.questionBlock}>
            <Text style={styles.questionHeader}>{question.header}</Text>
            <Text style={styles.prompt}>{question.question}</Text>
            <View style={styles.optionList}>
              {question.options.map((option) => {
                const selected = draft.selected?.includes(option.label) ?? false;
                return (
                  <Pressable
                    key={option.label}
                    disabled={disabled}
                    onPress={() => toggleOption(questionIndex, option.label, question.multiSelect === true)}
                    style={[styles.option, selected && styles.optionSelected]}
                    accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: selected, disabled }}
                  >
                    <Ionicons
                      name={question.multiSelect
                        ? selected ? 'checkbox-outline' : 'square-outline'
                        : selected ? 'radio-button-on-outline' : 'radio-button-off-outline'}
                      size={19}
                      color={selected ? colors.amber : colors.textSubtle}
                    />
                    <View style={styles.optionCopy}>
                      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{option.label}</Text>
                      {option.description ? <Text style={styles.optionDescription}>{option.description}</Text> : null}
                      {option.preview ? <Text style={styles.optionPreview}>{option.preview}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {!question.multiSelect ? (
              <TextInput
                value={draft.custom ?? ''}
                editable={!disabled}
                onChangeText={(custom) => onDraftsChange({
                  ...drafts,
                  [questionIndex]: { custom, selected: custom.trim() ? [] : draft.selected },
                })}
                placeholder={question.options.length > 0 ? 'Or write another answer' : 'Type your answer'}
                placeholderTextColor={colors.textSubtle}
                multiline
                style={styles.customInput}
              />
            ) : null}
          </View>
        );
      })}
      <View style={styles.submitRow}>
        <MindButton label="Cancel question" variant="ghost" disabled={disabled} onPress={onCancel} style={styles.submitButton} />
        <MindButton label="Submit answer" icon="send-outline" loading={disabled} onPress={onSubmit} style={styles.submitButton} />
      </View>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function formatInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input.slice(0, 800);
  try {
    return JSON.stringify(input, null, 2).slice(0, 800);
  } catch {
    return String(input).slice(0, 800);
  }
}

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute', right: spacing.lg, bottom: 92, zIndex: 40,
    minWidth: 52, height: 52, borderRadius: 26, paddingHorizontal: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.amber, ...shadows.floating,
  },
  floatingLabel: { color: colors.white, fontSize: typography.body, fontWeight: '800' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '88%', backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderBottomWidth: hairlineWidth, borderBottomColor: colors.border },
  headerIcon: { width: 36, height: 36, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.amberSoft },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.textSubtle, fontSize: typography.caption, fontWeight: '600' },
  title: { color: colors.text, fontSize: typography.title, fontWeight: '700' },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  actionBody: { gap: spacing.lg },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  runtimeLabel: { color: colors.amber, fontSize: typography.caption, fontWeight: '800', letterSpacing: 0.8 },
  riskLabel: { color: colors.warning, fontSize: typography.caption, fontWeight: '700', textTransform: 'uppercase' },
  riskHigh: { color: colors.errorText },
  prompt: { color: colors.text, fontSize: typography.bodyLarge, lineHeight: 21, fontWeight: '600' },
  detailBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.borderSubtle, gap: spacing.md },
  detailRow: { gap: spacing.xs },
  detailLabel: { color: colors.textSubtle, fontSize: typography.caption, fontWeight: '700', textTransform: 'uppercase' },
  detailValue: { color: colors.textMuted, fontSize: typography.body, lineHeight: 19 },
  buttonStack: { gap: spacing.sm },
  emptyOptions: { color: colors.errorText, fontSize: typography.caption, lineHeight: 17 },
  questionBlock: { gap: spacing.md, paddingBottom: spacing.lg, borderBottomWidth: hairlineWidth, borderBottomColor: colors.border },
  questionHeader: { color: colors.amber, fontSize: typography.caption, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  optionList: { gap: spacing.sm },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  optionSelected: { borderColor: colors.amberBorder, backgroundColor: colors.amberSoft },
  optionCopy: { flex: 1, gap: 2 },
  optionLabel: { color: colors.text, fontSize: typography.body, fontWeight: '600' },
  optionLabelSelected: { color: colors.amber },
  optionDescription: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 17 },
  optionPreview: { color: colors.textSubtle, fontSize: typography.caption, lineHeight: 17 },
  customInput: { minHeight: 72, color: colors.text, fontSize: typography.body, lineHeight: 20, textAlignVertical: 'top', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  submitRow: { flexDirection: 'row', gap: spacing.sm },
  submitButton: { flex: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.errorSoft, borderWidth: 1, borderColor: colors.errorBorder },
  errorText: { flex: 1, color: colors.errorText, fontSize: typography.caption, lineHeight: 17 },
  ownershipNote: { color: colors.textSubtle, fontSize: typography.caption, lineHeight: 17, textAlign: 'center' },
});
