import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ChatHeaderProps {
  title: string;
  onOpenSessions: () => void;
  onNewChat: () => void;
}

export default function ChatHeader({ title, onOpenSessions, onNewChat }: ChatHeaderProps) {
  return (
    <View style={styles.chatHeader}>
      <Pressable onPress={onOpenSessions} style={styles.iconButton} hitSlop={8}>
        <Ionicons name="menu-outline" size={22} color="#a8a29e" />
      </Pressable>
      <Text style={styles.chatHeaderTitle} numberOfLines={1}>
        {title}
      </Text>
      <Pressable onPress={onNewChat} style={styles.iconButton} hitSlop={8}>
        <Ionicons name="add-circle-outline" size={22} color="#c8873a" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  iconButton: { padding: 4 },
  chatHeaderTitle: {
    flex: 1,
    marginHorizontal: 12,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#d6d3d1',
  },
});