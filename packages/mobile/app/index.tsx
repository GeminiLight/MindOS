/**
 * Root index — redirects to tabs or connect screen based on connection state.
 */
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useConnectionStore } from '@/lib/connection-store';

export default function Index() {
  const status = useConnectionStore((s) => s.status);

  if (status === 'connected') {
    return <Redirect href="/(tabs)" />;
  }

  // Show loading while verifying saved connection
  if (status === 'connecting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#c8873a" size="large" />
      </View>
    );
  }

  return <Redirect href="/connect" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1917',
  },
});
