import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MindCard from '@/components/ui/MindCard';
import { mindosClient } from '@/lib/api-client';
import type { MobileContextFeedbackSignal, MobileRetrievalReceipt } from '@/lib/context-feedback';
import { colors, hairlineWidth, minTouchTarget, radius, spacing, typography } from '@/lib/theme';

const ASSET_DECISIONS: Array<{ signal: Exclude<MobileContextFeedbackSignal, 'missing'>; label: string }> = [
  { signal: 'helpful', label: 'Helpful' },
  { signal: 'irrelevant', label: 'Irrelevant' },
  { signal: 'stale', label: 'Stale' },
];

type FeedbackSnapshot = { id: string; signal: MobileContextFeedbackSignal; status: 'active' | 'retracted' };

export default function ContextLearningCard({ enabled }: { enabled: boolean }) {
  const [receipts, setReceipts] = useState<MobileRetrievalReceipt[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');
  const [feedback, setFeedback] = useState<Record<string, FeedbackSnapshot>>({});

  const load = useCallback(async () => {
    if (!enabled) {
      setReceipts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextReceipts, existing] = await Promise.all([
        mindosClient.getRetrievalReceipts({ limit: 4 }),
        mindosClient.getContextFeedback({ limit: 100 }),
      ]);
      setReceipts(nextReceipts);
      setFeedback(Object.fromEntries(existing.map((item) => [
        feedbackKey(item.receiptId, item.assetId),
        { id: item.id, signal: item.signal, status: item.status },
      ])));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Retrieval feedback is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (receiptId: string, signal: MobileContextFeedbackSignal, assetId?: string) => {
    const key = feedbackKey(receiptId, assetId);
    setSavingKey(key);
    try {
      const payload = await mindosClient.submitContextFeedback({ receiptId, signal, ...(assetId ? { assetId } : {}) });
      const saved = normalizeFeedback(payload.feedback, signal);
      if (saved) setFeedback((current) => ({ ...current, [key]: saved }));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Feedback could not be saved.');
    } finally {
      setSavingKey('');
    }
  };

  const undo = async (receiptId: string, assetId?: string) => {
    const key = feedbackKey(receiptId, assetId);
    const current = feedback[key];
    if (!current) return;
    setSavingKey(key);
    try {
      const payload = await mindosClient.retractContextFeedback(current.id);
      const saved = normalizeFeedback(payload.feedback, current.signal);
      if (saved) setFeedback((items) => ({ ...items, [key]: saved }));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Feedback could not be undone.');
    } finally {
      setSavingKey('');
    }
  };

  if (!enabled) return null;
  return (
    <MindCard>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Teach Recall</Text>
          <Text style={styles.subtitle}>Tell MindOS whether the context used by a recent answer helped.</Text>
        </View>
        {loading ? <ActivityIndicator size="small" color={colors.amber} /> : (
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh retrieval receipts" onPress={() => void load()} style={styles.refresh}>
            <Ionicons name="refresh-outline" size={17} color={colors.amber} />
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && receipts.length === 0 ? <Text style={styles.empty}>No recent retrieval receipts yet.</Text> : null}
      {receipts.slice(0, 3).map((receipt) => (
        <View key={receipt.id} style={styles.receipt}>
          <Text style={styles.query} numberOfLines={2}>{receipt.queryPreview || receipt.id}</Text>
          {receipt.selections.slice(0, 2).map((selection) => {
            const key = feedbackKey(receipt.id, selection.assetId);
            const current = feedback[key];
            return (
              <View key={selection.assetId} style={styles.selection}>
                <Text style={styles.path} numberOfLines={1}>{selection.path}</Text>
                <View style={styles.actions}>
                  {ASSET_DECISIONS.map((decision) => (
                    <DecisionButton
                      key={decision.signal}
                      label={decision.label}
                      selected={current?.status === 'active' && current.signal === decision.signal}
                      disabled={savingKey === key}
                      onPress={() => void submit(receipt.id, decision.signal, selection.assetId)}
                    />
                  ))}
                  {current?.status === 'active' ? <DecisionButton label="Undo" selected={false} disabled={savingKey === key} onPress={() => void undo(receipt.id, selection.assetId)} /> : null}
                </View>
                {current?.status === 'active' && current.signal === 'stale' ? (
                  <Text style={styles.reviewNote}>Stale feedback needs a separate review before this asset can be deprecated.</Text>
                ) : null}
              </View>
            );
          })}
          <View style={styles.missingRow}>
            <Text style={styles.missingCopy}>Needed context was not recalled?</Text>
            <DecisionButton
              label="Missing"
              selected={feedback[feedbackKey(receipt.id)]?.status === 'active'}
              disabled={savingKey === feedbackKey(receipt.id)}
              onPress={() => void submit(receipt.id, 'missing')}
            />
            {feedback[feedbackKey(receipt.id)]?.status === 'active' ? (
              <DecisionButton label="Undo" selected={false} disabled={savingKey === feedbackKey(receipt.id)} onPress={() => void undo(receipt.id)} />
            ) : null}
          </View>
        </View>
      ))}
    </MindCard>
  );
}

function DecisionButton({ label, selected, disabled, onPress }: {
  label: string; selected: boolean; disabled: boolean; onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.decision, selected && styles.decisionSelected, disabled && styles.disabled]}
    >
      <Text style={[styles.decisionText, selected && styles.decisionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function feedbackKey(receiptId: string, assetId?: string): string {
  return `${receiptId}:${assetId ?? 'missing'}`;
}

function normalizeFeedback(value: unknown, fallbackSignal: MobileContextFeedbackSignal): FeedbackSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  const signal = record.signal === 'helpful' || record.signal === 'irrelevant' || record.signal === 'stale' || record.signal === 'missing'
    ? record.signal
    : fallbackSignal;
  return { id: record.id, signal, status: record.status === 'retracted' ? 'retracted' : 'active' };
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  title: { color: colors.text, fontSize: typography.title, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 17 },
  refresh: { width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.amberSoft },
  error: { color: colors.errorText, fontSize: typography.caption },
  empty: { color: colors.textSubtle, fontSize: typography.caption },
  receipt: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: hairlineWidth, borderTopColor: colors.borderSubtle },
  query: { color: colors.text, fontSize: typography.body, fontWeight: '600' },
  selection: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  path: { color: colors.textMuted, fontSize: typography.caption },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  decision: { minHeight: minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  decisionSelected: { borderColor: colors.amberBorder, backgroundColor: colors.amberSoft },
  decisionText: { color: colors.textMuted, fontSize: typography.caption, fontWeight: '600' },
  decisionTextSelected: { color: colors.amber },
  disabled: { opacity: 0.5 },
  reviewNote: { color: colors.textSubtle, fontSize: 11, lineHeight: 15 },
  missingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  missingCopy: { flex: 1, minWidth: 150, color: colors.textSubtle, fontSize: typography.caption },
});
