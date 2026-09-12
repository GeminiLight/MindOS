import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * Root layout — initializes connection state with branded splash screen.
 */
import PendingAgentActionSheet from '@/components/agent/PendingAgentActionSheet';
import { useConnectionStore } from '@/lib/connection-store';
import { useWorkspaceIdentity } from '@/hooks/useWorkspaceIdentity';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const isDark = useColorScheme() === 'dark';
  const navigationTheme = isDark ? DarkTheme : DefaultTheme;
  const init = useConnectionStore((s) => s.init);
  const workspace = useWorkspaceIdentity();
  const ready = useConnectionStore(s => s.initialized);

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashLogo}>◆</Text>
        <Text style={styles.splashTitle}>MindOS</Text>
        <ActivityIndicator color={colors.amber} style={{ marginTop: 24 }} />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={{ ...navigationTheme, colors: { ...navigationTheme.colors, primary: colors.amber, background: colors.background, card: colors.background, text: colors.text, border: colors.borderSubtle } }}>
        <StatusBar style="auto" />
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
        <PendingAgentActionSheet key={workspace} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function createViewTheme(colors: ThemeColors) {
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
  return { styles };
}
