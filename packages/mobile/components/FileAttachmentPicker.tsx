/**
 * FileAttachmentPicker — Modal picker for attaching MindOS knowledge-base files to chat.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { mindosClient } from '@/lib/api-client';
import { flattenFiles } from '@/lib/file-tree';
import type { FileNode } from '@/lib/types';

interface FileAttachmentPickerProps {
  visible: boolean;
  selectedPaths: string[];
  onChangeSelectedPaths: React.Dispatch<React.SetStateAction<string[]>>;
  onClose: () => void;
}

export default function FileAttachmentPicker({
  visible,
  selectedPaths,
  onChangeSelectedPaths,
  onClose,
}: FileAttachmentPickerProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const tree = await mindosClient.getFileTree();
      setFiles(flattenFiles(tree));
    } catch (e) {
      setError((e as Error).message || 'Failed to load files');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const togglePath = useCallback((path: string) => {
    onChangeSelectedPaths((prev) => (
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    ));
  }, [onChangeSelectedPaths]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Attach files</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#c8873a" />
            <Text style={styles.stateText}>Loading files...</Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Ionicons name="warning-outline" size={28} color="#fca5a5" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : files.length === 0 ? (
          <View style={styles.centerState}>
            <Ionicons name="document-outline" size={28} color="#78716c" />
            <Text style={styles.stateText}>No files available to attach</Text>
          </View>
        ) : (
          <FlatList
            data={files}
            keyExtractor={(item) => item.path}
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={5}
            renderItem={({ item }) => {
              const selected = selectedSet.has(item.path);
              return (
                <Pressable style={styles.row} onPress={() => togglePath(item.path)}>
                  <Ionicons
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={selected ? '#c8873a' : '#78716c'}
                  />
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.filePath} numberOfLines={1}>{item.path}</Text>
                  </View>
                </Pressable>
              );
            }}
            contentContainerStyle={styles.listContent}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1917',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fafaf9',
  },
  cancelText: {
    fontSize: 14,
    color: '#a8a29e',
  },
  doneText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#c8873a',
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  stateText: {
    fontSize: 14,
    color: '#a8a29e',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#fca5a5',
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(200, 135, 58, 0.15)',
  },
  retryText: {
    color: '#c8873a',
    fontWeight: '600',
    fontSize: 14,
  },
  listContent: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#292524',
  },
  rowTextWrap: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    color: '#fafaf9',
    marginBottom: 2,
  },
  filePath: {
    fontSize: 12,
    color: '#78716c',
  },
});
