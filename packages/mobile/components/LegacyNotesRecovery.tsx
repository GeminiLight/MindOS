import { readLegacyCaptureNotes } from '@/lib/quick-capture';
import { useThemedStyles, type ThemeColors } from '@/lib/theme';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import MindButton from './ui/MindButton';
import MindCard from './ui/MindCard';

export default function LegacyNotesRecovery() {
  const { styles } = useThemedStyles(createViewTheme);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { void readLegacyCaptureNotes().then(setNotes).catch(e => setError(e.message)); }, []);
  if (!notes && !error) return null;
  return <MindCard>
    <Text style={styles.title}>Recover older notes</Text>
    <Text style={styles.copy}>An earlier version saved notes without a workspace identity. Copy them and choose where to save them. The originals stay on this device.</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <MindButton label={copied ? 'Copied — originals preserved' : 'Copy older notes'} variant="secondary" disabled={!notes}
      onPress={() => { void Clipboard.setStringAsync(notes).then(() => setCopied(true)).catch(() => setError('Could not copy. Please retry.')); }} />
  </MindCard>;
}
function createViewTheme(colors: ThemeColors) {
  return {
    styles: StyleSheet.create({
      title: { color: colors.text, fontSize: 16, fontWeight: '600' },
      copy: { color: colors.textMuted, fontSize: 14, lineHeight: 21, marginVertical: 12 },
      error: { color: colors.errorText, marginBottom: 12 }
    })
  };
}
