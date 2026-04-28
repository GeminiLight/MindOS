import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ScrollToBottomButtonProps {
  visible: boolean;
  onPress: () => void;
}

export default function ScrollToBottomButton({ visible, onPress }: ScrollToBottomButtonProps) {
  if (!visible) return null;

  return (
    <Pressable
      style={({ pressed }) => [styles.scrollBtn, pressed && styles.scrollBtnPressed]}
      onPress={onPress}
    >
      <Ionicons name="chevron-down" size={18} color="#fafaf9" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrollBtn: {
    position: 'absolute',
    right: 16,
    bottom: 80,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#44403c',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  scrollBtnPressed: { opacity: 0.7 },
});