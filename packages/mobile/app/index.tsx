import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * Root index — redirects to tabs or connect screen based on connection state.
 */
import { useConnectionStore } from '@/lib/connection-store';
import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export default function Index() {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const status = useConnectionStore((s) => s.status);

  const serverUrl = useConnectionStore(s => s.serverUrl);

  if (serverUrl) {
    return <Redirect href="/(tabs)" />;
  }

  // Show loading while verifying saved connection
  if (status === 'connecting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.amber} size="large" />
      </View>
    );
  }

  return <Redirect href="/connect" />;
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
  });
  return { styles };
}
