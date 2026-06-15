/**
 * QRScanner — Camera-based QR code scanner for connecting to MindOS server.
 */
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Dimensions } from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { parseMobilePairingPayload, type MobilePairingPayload } from '@/lib/pairing-payload';
import { colors, radius, spacing, typography } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SCAN_AREA_SIZE = SCREEN_WIDTH * 0.7;

interface QRScannerProps {
  onScan: (payload: MobilePairingPayload) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleBarCodeScanned = (result: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);

    const parsed = parseMobilePairingPayload(result.data);
    if (parsed.ok) {
      onScan(parsed.payload);
    } else {
      Alert.alert(
        'Invalid connection code',
        parsed.message,
        [{ text: 'Try Again', onPress: () => setScanned(false) }],
      );
    }
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Ionicons name="camera-outline" size={48} color={colors.textSubtle} />
        <Text style={styles.message}>Camera access is required to scan QR codes</Text>
        <Text style={styles.hint}>
          Please allow camera access in your device settings
        </Text>
        {permission.canAskAgain && (
          <Pressable style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </Pressable>
        )}
        <Pressable style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelText}>Enter URL Manually</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Overlay with cutout */}
      <View style={styles.overlay}>
        <View style={styles.overlayTop} />
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          <View style={styles.scanArea}>
            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom}>
          <Text style={styles.instruction}>
            Point your camera at a MindOS connection code
          </Text>
        </View>
      </View>

      {/* Close button */}
      <Pressable style={styles.closeButton} onPress={onClose} hitSlop={16}>
        <Ionicons name="close" size={28} color={colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  message: {
    fontSize: typography.title,
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.lg,
  },
  hint: {
    fontSize: typography.body,
    color: colors.textSubtle,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },
  button: {
    backgroundColor: colors.amber,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  buttonText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: typography.bodyLarge,
  },
  cancelButton: {
    paddingVertical: spacing.md,
  },
  cancelText: {
    color: colors.textSubtle,
    fontSize: typography.body,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTop: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.scrim,
  },
  overlayMiddle: {
    flexDirection: 'row',
    height: SCAN_AREA_SIZE,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  scanArea: {
    width: SCAN_AREA_SIZE,
    height: SCAN_AREA_SIZE,
    position: 'relative',
  },
  overlayBottom: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.scrim,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  instruction: {
    fontSize: typography.body,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 20,
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: colors.amber,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
