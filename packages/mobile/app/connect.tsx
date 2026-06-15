/**
 * Connect screen — first-time setup to connect to a MindOS server.
 * Supports both QR code scanning and manual URL entry.
 */
import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useConnectionStore } from '@/lib/connection-store';
import { formatConnectionDiagnostic } from '@/lib/connection-diagnostics';
import type { MobilePairingPayload } from '@/lib/pairing-payload';
import QRScanner from '@/components/QRScanner';
import MindButton from '@/components/ui/MindButton';
import MindCard from '@/components/ui/MindCard';
import MindTextInput from '@/components/ui/MindTextInput';
import StatusPill from '@/components/ui/StatusPill';
import { colors, hairlineWidth, radius, spacing, typography } from '@/lib/theme';

export default function ConnectScreen() {
  const router = useRouter();
  const { status, diagnostic, connect } = useConnectionStore();
  const [url, setUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [pairingNotice, setPairingNotice] = useState('');

  const isConnecting = status === 'connecting';
  const formattedError = status === 'error' ? formatConnectionDiagnostic(diagnostic) : null;

  async function handleConnect(serverUrl?: string, tokenOverride?: string) {
    const targetUrl = serverUrl ?? url.trim();
    if (!targetUrl || isConnecting) return;
    setShowScanner(false);
    const success = await connect(targetUrl, tokenOverride ?? authToken);
    if (success) {
      router.replace('/(tabs)');
    }
  }

  function handleQRScan(payload: MobilePairingPayload) {
    setUrl(payload.url);
    if (payload.authToken) {
      setAuthToken(payload.authToken);
      setShowToken(false);
    }
    setPairingNotice(payload.authToken ? 'Connection code added the access token.' : 'Connection code added the server address.');
    void handleConnect(payload.url, payload.authToken ?? authToken);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={styles.hero}>
          <View style={styles.logoMark}>
            <Text style={styles.logoGlyph}>◆</Text>
          </View>
          <Text style={styles.logo}>MindOS</Text>
          <Text style={styles.tagline}>Connect to your local workspace</Text>
        </View>

        <View style={styles.form}>
          <Pressable
            onPress={() => setShowScanner(true)}
            disabled={isConnecting}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <MindCard style={styles.qrButton}>
              <Ionicons name="qr-code-outline" size={24} color={colors.amber} />
              <View style={styles.qrCopy}>
                <Text style={styles.qrButtonTitle}>Scan QR code</Text>
                <Text style={styles.qrButtonHint}>Use a MindOS connection code</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
            </MindCard>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or enter address</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.label}>Server address</Text>
          <MindTextInput
            style={styles.input}
            value={url}
            onChangeText={(value) => {
              setUrl(value);
              setPairingNotice('');
            }}
            placeholder="http://192.168.1.10:3456"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            editable={!isConnecting}
            onSubmitEditing={() => handleConnect()}
          />

          {pairingNotice ? (
            <MindCard tone="success" style={styles.noticeBox}>
              <View style={styles.noticeRow}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
                <Text style={styles.noticeText}>{pairingNotice}</Text>
              </View>
            </MindCard>
          ) : null}

          <View style={styles.tokenHeader}>
            <View style={styles.tokenTitleRow}>
              <Text style={styles.label}>Access token</Text>
              {authToken.trim() ? <StatusPill label="Token ready" tone="warning" /> : null}
            </View>
            <Pressable
              onPress={() => setShowToken((value) => !value)}
              hitSlop={8}
              disabled={isConnecting}
            >
              <Text style={styles.tokenToggle}>{showToken ? 'Hide' : authToken ? 'Show' : 'Optional'}</Text>
            </Pressable>
          </View>

          {showToken || authToken ? (
            <MindTextInput
              style={styles.input}
              value={authToken}
              onChangeText={(value) => {
                setAuthToken(value);
                setPairingNotice('');
              }}
              placeholder="Paste API token"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!showToken}
              returnKeyType="go"
              editable={!isConnecting}
              onSubmitEditing={() => handleConnect()}
            />
          ) : null}

          {formattedError && (
            <MindCard tone="error" style={styles.errorBox}>
              <Text style={styles.errorTitle}>{formattedError.title}</Text>
              <Text style={styles.errorText}>{formattedError.message}</Text>
            </MindCard>
          )}

          <MindButton
            label="Connect"
            onPress={() => handleConnect()}
            disabled={isConnecting}
            loading={isConnecting}
            icon="arrow-forward"
          />

          <Text style={styles.hint}>
            Open MindOS on your computer and copy its local address. Protected servers need the API token.
          </Text>
        </View>
      </KeyboardAvoidingView>

      {/* QR Scanner Modal */}
      <Modal visible={showScanner} animationType="slide">
        <QRScanner
          onScan={handleQRScan}
          onClose={() => setShowScanner(false)}
        />
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoMark: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.amberBorder,
    marginBottom: spacing.md,
  },
  logoGlyph: {
    fontSize: 24,
    color: colors.amber,
  },
  logo: {
    fontSize: typography.hero,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  tagline: {
    fontSize: typography.title,
    color: colors.textMuted,
  },
  form: {
    gap: spacing.lg,
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.82,
  },
  qrCopy: {
    flex: 1,
  },
  qrButtonTitle: {
    fontSize: typography.bodyLarge,
    fontWeight: '600',
    color: colors.text,
  },
  qrButtonHint: {
    fontSize: typography.body,
    color: colors.textSubtle,
    marginTop: spacing.xs / 2,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.xs,
  },
  dividerLine: {
    flex: 1,
    height: hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: typography.caption,
    color: colors.textSubtle,
  },
  label: {
    fontSize: typography.body,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: -spacing.sm,
  },
  input: {
    borderRadius: radius.lg,
  },
  tokenHeader: {
    marginTop: -spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  tokenTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tokenToggle: {
    color: colors.amber,
    fontSize: typography.body,
    fontWeight: '600',
  },
  noticeBox: {
    paddingVertical: spacing.md,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  noticeText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 20,
  },
  errorBox: {
    paddingVertical: spacing.md,
  },
  errorTitle: {
    color: colors.errorText,
    fontSize: typography.bodyLarge,
    fontWeight: '700',
  },
  errorText: {
    color: colors.errorText,
    fontSize: typography.body,
    lineHeight: 20,
  },
  hint: {
    fontSize: typography.body,
    color: colors.textSubtle,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.xs,
  },
});
