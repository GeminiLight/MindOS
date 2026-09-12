import { useThemedStyles, type ThemeColors } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

interface ScrollToBottomButtonProps {
  visible: boolean;
  onPress: () => void;
}

export default function ScrollToBottomButton({ visible, onPress }: ScrollToBottomButtonProps) {
  const { colors, styles } = useThemedStyles(createViewTheme);
  if (!visible) return null;

  return (
    <Pressable
      style={({ pressed }) => [styles.scrollBtn, pressed && styles.scrollBtnPressed]}
      onPress={onPress}
    >
      <Ionicons name="chevron-down" size={18} color={colors.text} />
    </Pressable>
  );
}

function createViewTheme(colors: ThemeColors) {
  const styles = StyleSheet.create({
    scrollBtn: {
      position: 'absolute',
      right: 16,
      bottom: 80,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 3,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.3,
      shadowRadius: 2,
    },
    scrollBtnPressed: { opacity: 0.7 },
  });
  return { styles };
}
