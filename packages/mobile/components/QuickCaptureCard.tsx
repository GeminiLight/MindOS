/**
 * QuickCaptureCard — Home card for quickly appending notes to today's inbox.
 */

import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildInboxPath, isValidCapture, saveQuickCapture } from '@/lib/quick-capture';

interface QuickCaptureCardProps {
  onSaved: () => Promise<void> | void;
}

export default function QuickCaptureCard({ onSaved }: QuickCaptureCardProps) {
  const [captureMode, setCaptureMode] = useState(false);
  const [captureText, setCaptureText] = useState('');
  const [captureSaving, setCaptureSaving] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [sessionDate, setSessionDate] = useState<Date | null>(null);

  const activeDate = sessionDate ?? new Date();
  const inboxPath = buildInboxPath('inbox', activeDate);
  const canSave = isValidCapture(captureText) && !captureSaving;

  const resetEditor = useCallback(() => {
    setCaptureMode(false);
    setCaptureError('');
  }, []);

  const startEditing = useCallback(() => {
    setCaptureSuccess(false);
    setSavedPath('');
    setSessionDate(new Date());
    setCaptureMode(true);
  }, []);

  const handleCaptureSubmit = useCallback(async () => {
    if (!canSave) return;

    setCaptureError('');
    setCaptureSaving(true);

    try {
      const result = await saveQuickCapture(captureText, { pathDate: activeDate });
      await onSaved();
      setSavedPath(result.inboxPath);
      setCaptureText('');
      setCaptureSuccess(true);
      setCaptureMode(false);
    } catch (e) {
      setCaptureError((e as Error).message);
    } finally {
      setCaptureSaving(false);
    }
  }, [activeDate, canSave, captureText, onSaved]);

  if (captureSuccess) {
    return (
      <View style={styles.successCard}>
        <View style={styles.successContent}>
          <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
          <View style={styles.successTextWrap}>
            <Text style={styles.successTitle}>Saved to {savedPath}</Text>
            <Text style={styles.successSubtitle}>Your note was added to today's inbox</Text>
          </View>
        </View>
        <Pressable
          style={styles.successWriteMoreBtn}
          onPress={() => {
            startEditing();
          }}
        >
          <Text style={styles.successWriteMoreText}>Write more</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {!captureMode ? (
        <>
          <Text style={styles.title}>Quick Capture</Text>
          <Text style={styles.subtitle}>Capture a thought before it escapes</Text>
          <Pressable style={styles.startBtn} onPress={startEditing}>
            <Text style={styles.startText}>Start writing</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.label}>Save to: {inboxPath}</Text>
          <TextInput
            style={styles.input}
            value={captureText}
            onChangeText={setCaptureText}
            placeholder="I need to remember to..."
            placeholderTextColor="#78716c"
            multiline
            maxLength={1000}
            editable={!captureSaving}
            autoFocus
            textAlignVertical="top"
          />
          {captureError ? <Text style={styles.errorText}>{captureError}</Text> : null}
          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={resetEditor} disabled={captureSaving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              onPress={handleCaptureSubmit}
              disabled={!canSave}
            >
              {captureSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveText}>Save to Inbox</Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 16, marginBottom: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#292524', borderRadius: 12, borderWidth: 1, borderColor: '#44403c', gap: 10 },
  title: { fontSize: 16, fontWeight: '600', color: '#fafaf9' },
  subtitle: { fontSize: 13, color: '#a8a29e' },
  startBtn: { backgroundColor: '#c8873a', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  startText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  label: { fontSize: 12, color: '#78716c', fontWeight: '500' },
  input: { backgroundColor: '#1a1917', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#d6d3d1', fontSize: 14, minHeight: 96 },
  errorText: { fontSize: 12, color: '#fca5a5' },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, minHeight: 40, justifyContent: 'center' },
  cancelText: { fontSize: 13, color: '#a8a29e', fontWeight: '500' },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, backgroundColor: '#c8873a', minWidth: 120, minHeight: 40, justifyContent: 'center', alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  successCard: { marginHorizontal: 16, marginTop: 16, marginBottom: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(34, 197, 94, 0.3)', gap: 10 },
  successContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  successTextWrap: { flex: 1 },
  successTitle: { fontSize: 14, fontWeight: '600', color: '#22c55e' },
  successSubtitle: { fontSize: 12, color: '#86efac', marginTop: 2 },
  successWriteMoreBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: 'rgba(34, 197, 94, 0.15)', alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' },
  successWriteMoreText: { color: '#22c55e', fontWeight: '600', fontSize: 12 },
});
