/**
 * ChatInput — Message input field with send button, mode selector, and file attachments.
 */

import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AskMode } from '@/lib/types';

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (message: string) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  canSend?: boolean;
  mode?: AskMode;
  onModeChange?: (mode: AskMode) => void;
  attachedPaths?: string[];
  onOpenAttachmentPicker?: () => void;
  onRemoveAttachment?: (path: string) => void;
}

export default function ChatInput({
  value,
  onChangeText,
  onSend,
  onCancel,
  isLoading = false,
  canSend = true,
  mode = 'chat',
  onModeChange,
  attachedPaths = [],
  onOpenAttachmentPicker,
  onRemoveAttachment,
}: ChatInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);

  const canSubmit = value.trim().length > 0 && !isLoading && canSend;
  const attachDisabled = isLoading || !canSend;

  const handleSend = () => {
    if (canSubmit) {
      onSend(value.trim());
      onChangeText('');
    }
  };

  return (
    <View>
      {/* Mode selector */}
      <View style={styles.modeRow}>
        {(['chat', 'agent'] as const).map((m) => (
          <Pressable
            key={m}
            style={[styles.modeButton, mode === m && styles.modeButtonActive]}
            onPress={() => onModeChange?.(m)}
            disabled={isLoading}
          >
            <Ionicons
              name={m === 'chat' ? 'chatbubble-outline' : 'flash-outline'}
              size={14}
              color={mode === m ? '#c8873a' : '#78716c'}
            />
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
              {m === 'chat' ? 'Chat' : 'Agent'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Attachment chips */}
      {attachedPaths.length > 0 && (
        <View style={styles.attachmentRow}>
          {attachedPaths.map((path) => (
            <View key={path} style={styles.attachmentChip}>
              <Ionicons name="document-outline" size={12} color="#c8873a" />
              <Text style={styles.attachmentText} numberOfLines={1}>
                {path.split('/').pop() || path}
              </Text>
              <Pressable onPress={() => onRemoveAttachment?.(path)} hitSlop={6}>
                <Ionicons name="close" size={12} color="#78716c" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Input box */}
      <View style={[styles.inputContainer, isFocused && styles.inputContainerFocused]}>
        <Pressable
          style={[styles.attachButton, attachDisabled && styles.attachButtonDisabled]}
          onPress={onOpenAttachmentPicker}
          disabled={attachDisabled}
          hitSlop={6}
        >
          <Ionicons name="attach-outline" size={18} color={attachDisabled ? '#78716c' : '#c8873a'} />
        </Pressable>

        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder="Ask MindOS..."
          placeholderTextColor="#78716c"
          multiline
          maxLength={4000}
          editable={!isLoading && canSend}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          returnKeyType={Platform.OS === 'ios' ? 'default' : 'send'}
        />

        {isLoading ? (
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Ionicons name="stop-circle" size={20} color="#ef4444" />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendButton, !canSubmit && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSubmit}
          >
            <Ionicons name="send" size={16} color="#fff" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#292524',
  },
  modeButtonActive: {
    backgroundColor: 'rgba(200, 135, 58, 0.2)',
  },
  modeText: {
    fontSize: 12,
    color: '#78716c',
    fontWeight: '500',
  },
  modeTextActive: {
    color: '#c8873a',
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    backgroundColor: '#292524',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#44403c',
  },
  attachmentText: {
    maxWidth: 160,
    fontSize: 12,
    color: '#d6d3d1',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#292524',
    backgroundColor: '#1a1917',
  },
  inputContainerFocused: {
    borderTopColor: '#44403c',
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#292524',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachButtonDisabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    backgroundColor: '#292524',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fafaf9',
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#c8873a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  cancelButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
