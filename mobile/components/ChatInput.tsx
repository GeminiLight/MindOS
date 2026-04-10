/**
 * ChatInput — Message input field with send button and mode selector.
 */

import { useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AskMode } from '@/lib/types';

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (message: string) => void;
  isLoading?: boolean;
  canSend?: boolean;
  mode?: AskMode;
  onModeChange?: (mode: AskMode) => void;
}

export default function ChatInput({
  value,
  onChangeText,
  onSend,
  isLoading = false,
  canSend = true,
  mode = 'chat',
  onModeChange,
}: ChatInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);

  const handleSend = () => {
    if (value.trim() && !isLoading && canSend) {
      onSend(value.trim());
      onChangeText('');
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Mode selector */}
      <View style={styles.modeRow}>
        {(['chat', 'agent'] as const).map((m) => (
          <Pressable
            key={m}
            style={[
              styles.modeButton,
              mode === m && styles.modeButtonActive,
            ]}
            onPress={() => onModeChange?.(m)}
          >
            <Ionicons
              name={m === 'chat' ? 'chatbubble-outline' : 'sparkles'}
              size={14}
              color={mode === m ? '#c8873a' : '#78716c'}
            />
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
              {m === 'chat' ? 'Chat' : 'Agent'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Input box */}
      <View style={[styles.inputContainer, isFocused && styles.inputContainerFocused]}>
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
        />

        <Pressable
          style={[
            styles.sendButton,
            (!value.trim() || isLoading || !canSend) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!value.trim() || isLoading || !canSend}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={16} color="#fff" />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// Simple Text component for missing import
function Text({ children, style }: { children: React.ReactNode; style?: any }) {
  const { Text: RNText } = require('react-native');
  return <RNText style={style}>{children}</RNText>;
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
    opacity: 0.5,
  },
});
