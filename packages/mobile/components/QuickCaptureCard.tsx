import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * QuickCaptureCard — Home card for quickly appending notes to today's inbox.
 */

import MindButton from '@/components/ui/MindButton';
import MindCard from '@/components/ui/MindCard';
import MindTextInput from '@/components/ui/MindTextInput';
import {
  buildInboxPath,
  clearQuickCaptureDraft,
  isValidCapture,
  loadPendingCaptures,
  loadQuickCaptureDraft,
  queueQuickCapture,
  retryPendingCaptures,
  saveQuickCaptureDraft,
  type PendingQuickCapture,
} from '@/lib/quick-capture';
import { spacing, typography } from '@/lib/theme';
import { getWorkspaceIdentity } from '@/lib/workspace-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface QuickCaptureCardProps {
  onSaved: () => Promise<void> | void;
}

export default function QuickCaptureCard({ onSaved }: QuickCaptureCardProps) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const [workspace] = useState(getWorkspaceIdentity);
  const draftChangedRef = useRef(false);
  const busyRef = useRef(false);
  const draftRef = useRef('');
  const [captureMode, setCaptureMode] = useState(false);
  const [captureText, setCaptureText] = useState('');
  const [captureSaving, setCaptureSaving] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [sessionDate, setSessionDate] = useState<Date | null>(null);
  const [pendingCaptures, setPendingCaptures] = useState<PendingQuickCapture[]>([]);
  const [syncingPending, setSyncingPending] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const activeDate = useMemo(() => sessionDate ?? new Date(), [sessionDate]);
  const inboxPath = buildInboxPath('inbox', activeDate);
  const canSave = isValidCapture(captureText) && !captureSaving;
  const hasDraft = isValidCapture(captureText);
  const pendingCount = pendingCaptures.length;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadQuickCaptureDraft(workspace), loadPendingCaptures(workspace)]).then(([draft, pending]) => {
      if (cancelled) return;
      draftRef.current = draft; setCaptureText(draft);
      setPendingCaptures(pending);
    }).catch(() => { if (!cancelled) setCaptureError('Could not load local notes. Retry before writing.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!captureMode) return;
    const timer = setTimeout(() => {
      void saveQuickCaptureDraft(captureText, workspace).catch(() => setCaptureError('Draft could not be saved. Keep this screen open.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [captureMode, captureText]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active' && draftChangedRef.current) void saveQuickCaptureDraft(draftRef.current, workspace).catch(() => { }); });
    return () => { listener.remove(); if (draftChangedRef.current) void saveQuickCaptureDraft(draftRef.current, workspace).catch(() => { }); };
  }, []);

  const resetEditor = useCallback(() => {
    void saveQuickCaptureDraft(captureText, workspace).then(() => { setCaptureMode(false); setCaptureError(''); })
      .catch(() => setCaptureError('Draft could not be saved. Keep this screen open.'));
  }, [captureText]);

  const startEditing = useCallback(() => {
    setCaptureSuccess(false);
    setSyncMessage('');
    setSavedPath('');
    setSessionDate(new Date());
    setCaptureMode(true);
  }, []);

  const handleCaptureSubmit = useCallback(async () => {
    if (!canSave || busyRef.current) return;
    busyRef.current = true;

    setCaptureError('');
    setSyncMessage('');
    setCaptureSaving(true);

    const contentDate = new Date();
    try {
      // Persist the intent before any network operation, including the initial attempt.
      const queued = await queueQuickCapture(captureText, { pathDate: activeDate, contentDate, workspace });
      await clearQuickCaptureDraft(workspace);
      draftChangedRef.current = false; draftRef.current = '';
      setSavedPath(queued.inboxPath); setCaptureText(''); setCaptureMode(false);
      const result = await retryPendingCaptures();
      setPendingCaptures(result.remaining);
      const saved = result.saved.some(item => item.id === queued.id);
      setCaptureSuccess(saved);
      setSyncMessage(saved ? '' : 'Saved on this device. Sync when connected.');
      if (result.saved.length) await Promise.resolve(onSaved()).catch(() => { });
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'Could not save on this device. Keep your text and retry.');
    } finally {
      busyRef.current = false;
      setCaptureSaving(false);
    }
  }, [activeDate, canSave, captureText, onSaved]);

  const handleSyncPending = useCallback(async () => {
    if (syncingPending || pendingCount === 0) return;

    setSyncingPending(true);
    setCaptureError('');
    setSyncMessage('');
    try {
      const result = await retryPendingCaptures();
      setPendingCaptures(result.remaining);
      if (result.saved.length > 0) await onSaved();
      if (result.remaining.length === 0) {
        setSyncMessage(`Synced ${result.saved.length} capture${result.saved.length === 1 ? '' : 's'}`);
      } else {
        setCaptureError(result.error?.message ?? 'Some captures could not sync yet');
      }
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'Could not sync. Your notes remain on this device.');
    } finally {
      setSyncingPending(false);
    }
  }, [onSaved, pendingCount, syncingPending]);

  if (!captureMode && !captureSuccess && !pendingCount && !syncMessage && !captureError) {
    return <MindButton label={hasDraft ? 'Resume your quick note' : 'Capture a thought…'} icon="pencil-outline" variant="secondary" onPress={startEditing} />;
  }

  if (captureSuccess && pendingCount === 0) {
    return (
      <MindCard tone="success" style={styles.card}>
        <View style={styles.successContent}>
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
          <View style={styles.successTextWrap}>
            <Text style={styles.successTitle}>Saved to {savedPath}</Text>
            <Text style={styles.successSubtitle}>Added to today's inbox</Text>
          </View>
        </View>
        <MindButton
          label="Write more"
          icon="create-outline"
          variant="secondary"
          onPress={startEditing}
          style={styles.writeMoreButton}
        />
      </MindCard>
    );
  }

  return (
    <MindCard style={styles.card}>
      {pendingCount > 0 || syncMessage ? (
        <View style={[styles.pendingBar, pendingCount === 0 && styles.pendingBarSuccess]}>
          <Ionicons
            name={pendingCount > 0 ? 'cloud-upload-outline' : 'checkmark-circle-outline'}
            size={18}
            color={pendingCount > 0 ? colors.warning : colors.success}
          />
          <View style={styles.pendingCopy}>
            <Text style={[styles.pendingTitle, pendingCount === 0 && styles.pendingTitleSuccess]}>
              {pendingCount > 0 ? `${pendingCount} waiting to sync` : syncMessage}
            </Text>
            {pendingCount > 0 ? (
              <Text style={styles.pendingText} numberOfLines={1}>
                {pendingCaptures[0]?.inboxPath}
              </Text>
            ) : null}
          </View>
          {pendingCount > 0 ? (
            <MindButton
              label="Sync"
              icon="refresh-outline"
              variant="secondary"
              loading={syncingPending}
              disabled={syncingPending}
              onPress={() => { void handleSyncPending(); }}
              style={styles.syncButton}
            />
          ) : null}
        </View>
      ) : null}

      {captureError && !captureMode ? <Text accessibilityRole="alert" style={styles.errorText}>{captureError}</Text> : null}
      {!captureMode ? (
        <>
          <MindButton
            label={hasDraft ? 'Resume your quick note' : 'Capture a thought…'}
            variant="secondary"
            icon="pencil-outline"
            onPress={startEditing}
            style={styles.startButton}
          />
        </>
      ) : (
        <>
          <Text style={styles.label}>Save to: {inboxPath}</Text>
          <MindTextInput
            style={styles.input}
            value={captureText}
            onChangeText={text => { draftChangedRef.current = true; draftRef.current = text; setCaptureText(text); }}
            accessibilityLabel="Quick note"
            placeholder="I need to remember to..."
            multiline
            maxLength={1000}
            editable={!captureSaving}
            autoFocus
            textAlignVertical="top"
          />
          {captureError ? <Text style={styles.errorText}>{captureError}</Text> : null}
          <View style={styles.actions}>
            <MindButton
              label="Keep draft"
              variant="ghost"
              onPress={resetEditor}
              disabled={captureSaving}
              style={styles.actionButton}
            />
            <MindButton
              label="Save"
              icon="archive-outline"
              onPress={handleCaptureSubmit}
              disabled={!canSave}
              loading={captureSaving}
              style={styles.actionButton}
            />
          </View>
        </>
      )}
    </MindCard>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    card: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      marginBottom: spacing.md,
    },
    title: {
      fontSize: typography.title,
      fontWeight: '700',
      color: colors.text,
    },
    subtitle: {
      fontSize: typography.body,
      color: colors.textMuted,
    },
    startButton: {
      alignSelf: 'flex-start',
    },
    label: {
      fontSize: typography.caption,
      color: colors.textSubtle,
      fontWeight: '600',
    },
    input: {
      backgroundColor: colors.background,
      minHeight: 108,
      fontSize: typography.body,
      color: colors.text,
    },
    errorText: {
      fontSize: typography.caption,
      color: colors.errorText,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'flex-end',
    },
    actionButton: {
      minWidth: 104,
    },
    pendingBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 10,
      backgroundColor: colors.warningSoft,
      borderWidth: 1,
      borderColor: colors.warningBorder,
    },
    pendingBarSuccess: {
      backgroundColor: colors.successSoft,
      borderColor: colors.successBorder,
    },
    pendingCopy: {
      flex: 1,
    },
    pendingTitle: {
      color: colors.warning,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    pendingTitleSuccess: {
      color: colors.success,
    },
    pendingText: {
      color: colors.textMuted,
      fontSize: typography.caption,
      marginTop: 2,
    },
    syncButton: {
      minHeight: 34,
      paddingHorizontal: spacing.md,
    },
    successContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    successTextWrap: { flex: 1 },
    successTitle: {
      fontSize: typography.body,
      fontWeight: '700',
      color: colors.success,
    },
    successSubtitle: {
      fontSize: typography.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
    writeMoreButton: {
      alignSelf: 'flex-start',
    },
  });
  return { styles };
}
