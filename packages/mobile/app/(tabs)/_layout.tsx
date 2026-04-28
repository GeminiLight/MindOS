/**
 * Tab navigator with OfflineBanner overlay when connection drops.
 */
import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OfflineBanner from '@/components/OfflineBanner';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({ name, color, size }: { name: IoniconsName; color: string; size: number }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function TabLayout() {
  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1917' },
          headerTintColor: '#fafaf9',
          tabBarStyle: {
            backgroundColor: '#1a1917',
            borderTopColor: '#292524',
          },
          tabBarActiveTintColor: '#c8873a',
          tabBarInactiveTintColor: '#78716c',
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <TabIcon name="home-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="files"
          options={{
            title: 'Files',
            tabBarIcon: ({ color, size }) => <TabIcon name="folder-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Chat',
            tabBarIcon: ({ color, size }) => <TabIcon name="chatbubble-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: 'Search',
            tabBarIcon: ({ color, size }) => <TabIcon name="search-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size }) => <TabIcon name="settings-outline" color={color} size={size} />,
          }}
        />
      </Tabs>
      <BannerOverlay />
    </View>
  );
}

/** Renders OfflineBanner as absolute overlay below header, inside safe area. */
function BannerOverlay() {
  const insets = useSafeAreaInsets();
  // Position below status bar + navigation header (~44pt)
  return (
    <View style={[styles.bannerOverlay, { top: insets.top + 48 }]} pointerEvents="box-none">
      <OfflineBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1917' },
  bannerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
});
