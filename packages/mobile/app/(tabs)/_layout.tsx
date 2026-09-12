import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * Tab navigator with OfflineBanner overlay when connection drops.
 */
import { useWorkspaceIdentity } from '@/hooks/useWorkspaceIdentity';
import type { MobileIconName } from '@/lib/mobile-icons';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';

function TabIcon({ name, color, size }: { name: MobileIconName; color: ColorValue; size: number }) {
  const { } = useThemedStyles(createViewTheme);
  return <Ionicons name={name} size={size} color={color} />;
}

export default function TabLayout() {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const identity = useWorkspaceIdentity();
  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
        <Tabs key={identity}
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            tabBarStyle: {
              backgroundColor: colors.background,
              borderTopColor: colors.borderSubtle,
            },
            tabBarActiveTintColor: colors.amber,
            tabBarInactiveTintColor: colors.textSubtle,
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
              headerShown: false,
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
      </View>
    </View>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    bannerOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      zIndex: 10,
    },
  });
  return { styles };
}
