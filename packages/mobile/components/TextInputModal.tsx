import { useThemedStyles, type ThemeColors } from '@/lib/theme';
/**
 * TextInputModal — Simple modal with text input for Android (replaces Alert.prompt).
 */
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

interface TextInputModalProps {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  submitText?: string;
  cancelText?: string;
}

export default function TextInputModal({
  visible,
  title,
  message,
  placeholder,
  defaultValue = '',
  onSubmit,
  onCancel,
  submitText = 'OK',
  cancelText = 'Cancel',
}: TextInputModalProps) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue, visible]);

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  const handleCancel = () => {
    onCancel();
    setValue(defaultValue);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleCancel} />
        <View style={styles.container}>
          <Text style={styles.title}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textSubtle}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleSubmit}
          />
          <View style={styles.buttons}>
            <Pressable style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelText}>{cancelText}</Text>
            </Pressable>
            <Pressable
              style={[styles.submitBtn, !value.trim() && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!value.trim()}
            >
              <Text style={styles.submitText}>{submitText}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    container: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 20,
      width: '85%',
      maxWidth: 320,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    message: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: 16,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
      marginBottom: 16,
    },
    buttons: {
      flexDirection: 'row',
      gap: 12,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: colors.border,
      alignItems: 'center',
    },
    cancelText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    submitBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: colors.amberAction,
      alignItems: 'center',
    },
    submitBtnDisabled: {
      opacity: 0.5,
    },
    submitText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.white,
    },
  });
  return { styles };
}
