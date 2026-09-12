import { radius, spacing, typography, useThemedStyles, type ThemeColors } from '@/lib/theme';
import { forwardRef } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';

const MindTextInput = forwardRef<TextInput, TextInputProps>(function MindTextInput(
  { style, placeholderTextColor, ...props },
  ref,
) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  return (
    <TextInput
      ref={ref}
      style={[styles.input, style]}
      placeholderTextColor={placeholderTextColor ?? colors.textSubtle}
      {...props}
    />
  );
});

export default MindTextInput;

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    input: {
      outlineColor: colors.amber,
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
  return { styles };
}
