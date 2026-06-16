/**
 * Root layout — initializes connection state with branded splash screen.
 */
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useConnectionStore } from '@/lib/connection-store';
import { colors } from '@/lib/theme';

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
        <ActivityIndicator color={colors.amber} style={{ marginTop: 24 }} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="agent-runs" options={{ title: 'Agent Runs' }} />
        <Stack.Screen name="view/[...path]" />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    fontSize: 48,
    color: colors.amber,
    marginBottom: 12,
  },
  splashTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 1,
  },
});
