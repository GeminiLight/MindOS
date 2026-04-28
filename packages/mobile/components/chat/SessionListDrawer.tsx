/**
 * SessionListDrawer — Bottom sheet showing chat session history.
 */

import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  StyleSheet,
  Alert,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TextInputModal from '@/components/TextInputModal';
import type { ChatSessionMeta } from '@/lib/chat-session-store';

interface SessionListDrawerProps {
  visible: boolean;
  sessions: ChatSessionMeta[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onRename: (sessionId: string, newTitle: string) => void;
  onDelete: (sessionId: string) => void;
  onClose: () => void;
}

export default function SessionListDrawer({
  visible,
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onClose,
}: SessionListDrawerProps) {
  const [renameTarget, setRenameTarget] = useState<ChatSessionMeta | null>(null);

  const handleLongPress = useCallback((session: ChatSessionMeta) => {
    const options = ['Rename', 'Delete', 'Cancel'];
    const destructiveIndex = 1;
    const cancelIndex = 2;

    const handleAction = (index: number) => {
      if (index === 0) {
        // Rename - handled via TextInputModal in parent or inline
        if (Platform.OS === 'ios') {
          Alert.prompt(
            'Rename Session',
            'Enter a new name',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Rename', onPress: (text) => text?.trim() && onRename(session.id, text.trim()) },
            ],
            'plain-text',
            session.title,
          );
        } else {
          setRenameTarget(session);
        }
      } else if (index === 1) {
        Alert.alert(
          'Delete Session',
          `Delete "${session.title}"? This cannot be undone.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => onDelete(session.id) },
          ],
        );
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, destructiveButtonIndex: destructiveIndex, cancelButtonIndex: cancelIndex },
        handleAction,
      );
    } else {
      Alert.alert(
        session.title,
        'What would you like to do?',
        [
          { text: 'Rename', onPress: () => handleAction(0) },
          { text: 'Delete', style: 'destructive', onPress: () => handleAction(1) },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    }
  }, [onRename, onDelete]);

  const formatTimeAgo = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.drawer}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Sessions</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#a8a29e" />
            </Pressable>
          </View>

          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.sessionRow, item.id === activeSessionId && styles.sessionRowActive]}
                onPress={() => { onSelect(item.id); onClose(); }}
                onLongPress={() => handleLongPress(item)}
              >
                <View style={styles.sessionInfo}>
                  <Text style={styles.sessionTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.sessionMeta}>
                    {item.messageCount} messages · {formatTimeAgo(item.updatedAt)}
                  </Text>
                </View>
                {item.id === activeSessionId && (
                  <Ionicons name="checkmark" size={18} color="#c8873a" />
                )}
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="chatbubbles-outline" size={32} color="#44403c" />
                <Text style={styles.emptyText}>No chat sessions yet</Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />

          <Pressable style={styles.newChatBtn} onPress={() => { onNewChat(); onClose(); }}>
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={styles.newChatText}>New Chat</Text>
          </Pressable>

          <TextInputModal
            visible={renameTarget !== null}
            title="Rename Session"
            message={`Enter a new name for "${renameTarget?.title ?? ''}"`}
            placeholder="Session name"
            defaultValue={renameTarget?.title ?? ''}
            submitText="Rename"
            onSubmit={(value) => {
              if (!renameTarget) return;
              onRename(renameTarget.id, value);
              setRenameTarget(null);
            }}
            onCancel={() => setRenameTarget(null)}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawer: {
    backgroundColor: '#1a1917',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    paddingBottom: 24,
    borderTopWidth: 1,
    borderColor: '#292524',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fafaf9',
  },
  listContent: {
    paddingVertical: 8,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  sessionRowActive: {
    backgroundColor: 'rgba(200, 135, 58, 0.08)',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fafaf9',
  },
  sessionMeta: {
    fontSize: 12,
    color: '#78716c',
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#78716c',
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    backgroundColor: '#c8873a',
    borderRadius: 10,
  },
  newChatText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
