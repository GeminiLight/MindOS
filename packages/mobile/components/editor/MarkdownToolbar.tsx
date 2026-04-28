/**
 * MarkdownToolbar — Keyboard-top toolbar for quick Markdown formatting.
 * Meets Apple HIG 44pt minimum touch targets.
 */
import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { TOOLBAR_ACTIONS, TOOLBAR_ORDER } from './markdown-actions';
import type { ToolbarAction } from './markdown-actions';

const A11Y_LABELS: Record<ToolbarAction, string> = {
  heading: 'Heading',
  bold: 'Bold',
  italic: 'Italic',
  code: 'Inline Code',
  strikethrough: 'Strikethrough',
  bullet: 'Bullet List',
  numbered: 'Numbered List',
  task: 'Task Item',
  quote: 'Block Quote',
  link: 'Insert Link',
  divider: 'Horizontal Rule',
};

interface MarkdownToolbarProps {
  onAction: (action: ToolbarAction) => void;
  disabled?: boolean;
}

export default function MarkdownToolbar({ onAction, disabled }: MarkdownToolbarProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.container}
      style={styles.scroll}
    >
      {TOOLBAR_ORDER.map((action) => {
        const config = TOOLBAR_ACTIONS[action];
        return (
          <Pressable
            key={action}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              disabled && styles.buttonDisabled,
            ]}
            onPress={() => onAction(action)}
            disabled={disabled}
            accessibilityLabel={A11Y_LABELS[action]}
            accessibilityRole="button"
            hitSlop={4}
          >
            <Text style={[styles.buttonText, disabled && styles.textDisabled]}>
              {config.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: '#292524',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#44403c',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#1a1917',
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: '#44403c',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#d6d3d1',
    fontFamily: 'monospace',
  },
  textDisabled: {
    color: '#78716c',
  },
});
