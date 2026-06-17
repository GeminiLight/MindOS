import type { ComponentProps } from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';
import type { FileNode } from './types';

export type MobileIconName = ComponentProps<typeof Ionicons>['name'];

type FileIconNode = Pick<FileNode, 'type' | 'extension' | 'isSpace'>;

export function getFileNodeIcon(node: FileIconNode): MobileIconName {
  if (node.type === 'directory') {
    return node.isSpace ? 'layers-outline' : 'folder-outline';
  }

  switch (node.extension?.toLowerCase()) {
    case '.csv':
    case '.tsv':
      return 'grid-outline';
    case '.json':
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
      return 'code-slash-outline';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
      return 'image-outline';
    default:
      return 'document-text-outline';
  }
}
