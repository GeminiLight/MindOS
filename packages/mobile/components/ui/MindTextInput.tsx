import { forwardRef } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';
import { colors, radius, spacing, typography } from '@/lib/theme';

const MindTextInput = forwardRef<TextInput, TextInputProps>(function MindTextInput(
  { style, placeholderTextColor = colors.textSubtle, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      style={[styles.input, style]}
      placeholderTextColor={placeholderTextColor}
      {...props}
    />
  );
});

export default MindTextInput;

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: typography.title,
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
