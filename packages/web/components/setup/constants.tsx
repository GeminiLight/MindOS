import { Globe, BookOpen, FileText } from 'lucide-react';
import type { Template } from './types';

export const TEMPLATES: Array<{ id: Template; icon: React.ReactNode; dirs: string[] }> = [
  { id: 'en', icon: <Globe size={18} />, dirs: ['Profile/', 'Connections/', 'Notes/', 'Workflows/', 'Resources/', 'Projects/'] },
  { id: 'zh', icon: <BookOpen size={18} />, dirs: ['画像/', '关系/', '笔记/', '流程/', '资源/', '项目/'] },
  { id: 'empty', icon: <FileText size={18} />, dirs: ['README.md', 'CONFIG.json', 'INSTRUCTION.md'] },
];

export const TOTAL_STEPS = 4;
export const STEP_KB = 0;
export const STEP_AI = 1;
export const STEP_AGENTS = 2;
export const STEP_REVIEW = 3;
