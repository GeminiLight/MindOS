import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * ChatInput — Message input field with send button, intent selector, and file attachments.
 */

import { hairlineWidth, radius, spacing, typography } from '@/lib/theme';
import type { ComposerIntent } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (message: string) => boolean | void;
  onCancel?: () => void;
  isLoading?: boolean;
  canSend?: boolean;
  composerIntent?: ComposerIntent;
  onComposerIntentChange?: (intent: ComposerIntent) => void;
  hostActionsEnabled?: boolean;
  placeholder?: string;
  modeHint?: string;
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
  composerIntent = 'chat',
  onComposerIntentChange,
  hostActionsEnabled = false,
  placeholder = 'Ask MindOS...',
  modeHint,
  attachedPaths = [],
  onOpenAttachmentPicker,
  onRemoveAttachment,
}: ChatInputProps) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);

  const canSubmit = value.trim().length > 0 && !isLoading && canSend;
  const attachDisabled = isLoading || !canSend;

  const handleSend = () => {
    if (canSubmit) {
      if (onSend(value.trim()) !== false) onChangeText('');
    }
  };

  return (
    <View>
      {hostActionsEnabled ? (
        <View style={styles.modePanel}>
          <View style={styles.modeRow}>
            {(['chat', 'act'] as const).map((intent) => {
              const selected = composerIntent === intent;
              return (
                <Pressable
                  key={intent}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: isLoading }}
                  style={[styles.modeButton, selected && styles.modeButtonActive]}
                  onPress={() => onComposerIntentChange?.(intent)}
                  disabled={isLoading}
                >
                  <Ionicons
                    name={intent === 'chat' ? 'chatbubble-outline' : 'flash-outline'}
                    size={14}
                    color={selected ? colors.amber : colors.textSubtle}
                  />
                  <Text style={[styles.modeText, selected && styles.modeTextActive]}>
                    {intent === 'chat' ? 'Chat' : 'Act'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {modeHint ? (
            <Text style={styles.modeHint} numberOfLines={2}>
              {modeHint}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Attachment chips */}
      {attachedPaths.length > 0 && (
        <View style={styles.attachmentRow}>
          {attachedPaths.map((path) => (
            <View key={path} style={styles.attachmentChip}>
              <Ionicons name="document-outline" size={12} color={colors.amber} />
              <Text style={styles.attachmentText} numberOfLines={1}>
                {path.split('/').pop() || path}
              </Text>
              <Pressable onPress={() => onRemoveAttachment?.(path)} hitSlop={6}>
                <Ionicons name="close" size={12} color={colors.textSubtle} />
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
          <Ionicons name="attach-outline" size={18} color={attachDisabled ? colors.textSubtle : colors.amber} />
        </Pressable>

        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSubtle}
          multiline
          maxLength={4000}
          editable={!isLoading && canSend}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          returnKeyType={Platform.OS === 'ios' ? 'default' : 'send'}
        />

        {isLoading ? (
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Ionicons name="stop-circle" size={20} color={colors.error} />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendButton, !canSubmit && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSubmit}
          >
            <Ionicons name="send" size={16} color={colors.white} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    modePanel: {
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      borderTopWidth: hairlineWidth,
      borderTopColor: colors.borderSubtle,
      backgroundColor: colors.background,
    },
    modeRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      alignSelf: 'flex-start',
      padding: 3,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surfaceMuted,
    },
    modeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: 30,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
      borderRadius: radius.md,
    },
    modeButtonActive: {
      backgroundColor: colors.amberSoft,
    },
    modeText: {
      fontSize: typography.caption,
      color: colors.textSubtle,
      fontWeight: '500',
    },
    modeTextActive: {
      color: colors.amber,
    },
    modeHint: {
      fontSize: typography.caption,
      lineHeight: 17,
      color: colors.textSubtle,
    },
    attachmentRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    attachmentChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: '100%',
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    attachmentText: {
      maxWidth: 160,
      fontSize: typography.caption,
      color: colors.textMuted,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderTopWidth: hairlineWidth,
      borderTopColor: colors.borderSubtle,
      backgroundColor: colors.background,
    },
    inputContainerFocused: {
      borderTopColor: colors.border,
    },
    attachButton: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
    },
    attachButtonDisabled: {
      opacity: 0.5,
    },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      color: colors.text,
      fontSize: typography.body,
      maxHeight: 100,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.amberAction,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendButtonDisabled: {
      opacity: 0.4,
    },
    cancelButton: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.errorSoft,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
  return { styles };
}
