/**
 * Root layout — initializes connection state with branded splash screen.
 */
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useConnectionStore } from '@/lib/connection-store';

export default function RootLayout() {
  const init = useConnectionStore((s) => s.init);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    init().finally(() => setReady(true));
  }, [init]);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashLogo}>◆</Text>
        <Text style={styles.splashTitle}>MindOS</Text>
        <ActivityIndicator color="#c8873a" style={{ marginTop: 24 }} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Slot />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#1a1917',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    fontSize: 48,
    color: '#c8873a',
    marginBottom: 12,
  },
  splashTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fafaf9',
    letterSpacing: 1,
  },
});
