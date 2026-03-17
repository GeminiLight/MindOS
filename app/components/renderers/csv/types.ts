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

const TAG_COLORS = [
  { bg: 'rgba(200,135,58,0.12)', text: 'var(--amber)' },
  { bg: 'rgba(122,173,128,0.12)', text: 'var(--success)' },
  { bg: 'rgba(138,180,216,0.12)', text: '#8ab4d8' },
  { bg: 'rgba(200,160,216,0.12)', text: '#c8a0d8' },
  { bg: 'rgba(200,96,96,0.12)', text: '#c86060' },
  { bg: 'rgba(150,150,150,0.12)', text: 'var(--muted-foreground)' },
];

export function tagColor(val: string) {
  let h = 0;
  for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}
