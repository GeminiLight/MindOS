import Papa from 'papaparse';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewType = 'table' | 'gallery' | 'board';

export interface TableConfig {
  sortField: string;
  sortDir: 'asc' | 'desc';
  groupField: string;
  hiddenFields: string[];
}

export interface GalleryConfig {
  titleField: string;
  descField: string;
  tagField: string;
}

export interface BoardConfig {
  groupField: string;
  titleField: string;
  descField: string;
}

export interface CsvConfig {
  activeView: ViewType;
  table: TableConfig;
  gallery: GalleryConfig;
  board: BoardConfig;
}

export function defaultConfig(headers: string[]): CsvConfig {
  return {
    activeView: 'table',
    table: { sortField: '', sortDir: 'asc', groupField: '', hiddenFields: [] },
    gallery: { titleField: headers[0] ?? '', descField: headers[1] ?? '', tagField: headers[2] ?? '' },
    board: { groupField: headers[headers.length - 1] ?? '', titleField: headers[0] ?? '', descField: headers[1] ?? '' },
  };
}

function configKey(filePath: string) { return `mindos-csv-config:${filePath}`; }

export function loadConfig(filePath: string, headers: string[]): CsvConfig {
  try {
    const raw = localStorage.getItem(configKey(filePath));
    if (raw) {
      const parsed = JSON.parse(raw);
      const def = defaultConfig(headers);
      return { ...def, ...parsed, table: { ...def.table, ...parsed.table }, gallery: { ...def.gallery, ...parsed.gallery }, board: { ...def.board, ...parsed.board } };
    }
  } catch { /* ignore */ }
  return defaultConfig(headers);
}

export function saveConfig(filePath: string, cfg: CsvConfig) {
  try { localStorage.setItem(configKey(filePath), JSON.stringify(cfg)); } catch { /* ignore */ }
}

// ─── Parse / serialize ────────────────────────────────────────────────────────

export function parseCSV(content: string) {
  const result = Papa.parse<string[]>(content, { skipEmptyLines: true });
  const data = result.data as string[][];
  return { headers: data[0] ?? [], rows: data.slice(1) };
}

export function serializeCSV(headers: string[], rows: string[][]) {
  return Papa.unparse([headers, ...rows]);
}

// ─── Tag color ────────────────────────────────────────────────────────────────

export interface TagTone {
  badge: string;
  dot: string;
  text: string;
}

const TAG_TONES: TagTone[] = [
  {
    badge: 'bg-[var(--amber-subtle)] text-[var(--amber-text)]',
    dot: 'bg-[var(--amber)]',
    text: 'text-[var(--amber)]',
  },
  {
    badge: 'bg-success/10 text-success',
    dot: 'bg-success',
    text: 'text-success',
  },
  {
    badge: 'bg-[var(--tool-read)]/10 text-[var(--tool-read)]',
    dot: 'bg-[var(--tool-read)]',
    text: 'text-[var(--tool-read)]',
  },
  {
    badge: 'bg-[var(--tool-search)]/10 text-[var(--tool-search)]',
    dot: 'bg-[var(--tool-search)]',
    text: 'text-[var(--tool-search)]',
  },
  {
    badge: 'bg-error/10 text-error',
    dot: 'bg-error',
    text: 'text-error',
  },
  {
    badge: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/50',
    text: 'text-muted-foreground',
  },
];

export function tagTone(val: string): TagTone {
  let h = 0;
  for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) & 0xffff;
  return TAG_TONES[h % TAG_TONES.length];
}
