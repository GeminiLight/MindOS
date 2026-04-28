/**
 * Connect screen — first-time setup to connect to a MindOS server.
 * Supports both QR code scanning and manual URL entry.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useConnectionStore } from '@/lib/connection-store';
import QRScanner from '@/components/QRScanner';

export default function ConnectScreen() {
  const router = useRouter();
  const { status, error, connect } = useConnectionStore();
  const [url, setUrl] = useState('http://');
  const [showScanner, setShowScanner] = useState(false);

  const isConnecting = status === 'connecting';

  async function handleConnect(serverUrl?: string) {
    const targetUrl = serverUrl ?? url.trim();
    if (!targetUrl || isConnecting) return;
    setShowScanner(false);
    const success = await connect(targetUrl);
    if (success) {
      router.replace('/(tabs)');
    }
  }

  function handleQRScan(scannedUrl: string) {
    setUrl(scannedUrl);
    handleConnect(scannedUrl);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={styles.hero}>
          <Text style={styles.logo}>◆ MindOS</Text>
          <Text style={styles.tagline}>Your Mind, Everywhere</Text>
        </View>

        <View style={styles.form}>
          {/* QR Scan Button */}
          <Pressable
            style={styles.qrButton}
            onPress={() => setShowScanner(true)}
            disabled={isConnecting}
          >
            <Ionicons name="qr-code-outline" size={24} color="#c8873a" />
            <View style={{ flex: 1 }}>
              <Text style={styles.qrButtonTitle}>Scan QR Code</Text>
              <Text style={styles.qrButtonHint}>Fastest way to connect</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#78716c" />
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or enter manually</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.label}>MindOS Server Address</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.1.10:3456"
            placeholderTextColor="#78716c"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            editable={!isConnecting}
            onSubmitEditing={() => handleConnect()}
          />

          {status === 'error' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            style={[styles.button, isConnecting && styles.buttonDisabled]}
            onPress={() => handleConnect()}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </Pressable>

          <Text style={styles.hint}>
            Open MindOS on your computer, go to Settings → Mobile{'\n'}
            to find the QR code or server address.
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
    backgroundColor: '#1a1917',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 32,
    fontWeight: '700',
    color: '#c8873a',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: '#a8a29e',
  },
  form: {
    gap: 16,
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#292524',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#44403c',
  },
  qrButtonTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fafaf9',
  },
  qrButtonHint: {
    fontSize: 13,
    color: '#78716c',
    marginTop: 2,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#44403c',
  },
  dividerText: {
    fontSize: 12,
    color: '#78716c',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#d6d3d1',
    marginBottom: -8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#44403c',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fafaf9',
    backgroundColor: '#292524',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#c8873a',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    fontSize: 13,
    color: '#78716c',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 4,
  },
});
