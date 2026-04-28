/**
 * CSVTable — Renders CSV/TSV content as a horizontally scrollable table.
 * Handles: quoted fields, CRLF, empty rows, tab-delimited files.
 */
import { View, Text, ScrollView, StyleSheet } from 'react-native';

interface CSVTableProps {
  content: string;
  /** Delimiter character. Default ',' for CSV, pass '\t' for TSV. */
  delimiter?: string;
}

export default function CSVTable({ content, delimiter = ',' }: CSVTableProps) {
  const rows = parseDelimited(content, delimiter);
  if (rows.length === 0) return <Text style={styles.empty}>Empty file</Text>;

  const header = rows[0];
  const body = rows.slice(1);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={styles.scrollH}>
      <View>
        {/* Header row */}
        <View style={[styles.row, styles.headerRow]}>
          {header.map((cell, i) => (
            <View key={i} style={[styles.cell, styles.headerCell]}>
              <Text style={styles.headerText} numberOfLines={2}>{cell}</Text>
            </View>
          ))}
        </View>

        {/* Data rows */}
        <ScrollView style={styles.scrollV} nestedScrollEnabled>
          {body.map((row, ri) => (
            <View key={ri} style={[styles.row, ri % 2 === 1 && styles.rowAlt]}>
              {row.map((cell, ci) => (
                <View key={ci} style={styles.cell}>
                  <Text style={styles.cellText} numberOfLines={3}>{cell}</Text>
                </View>
              ))}
              {/* Pad missing cells if row is shorter than header */}
              {row.length < header.length &&
                Array.from({ length: header.length - row.length }).map((_, pi) => (
                  <View key={`pad-${pi}`} style={styles.cell} />
                ))
              }
            </View>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

/** Parse delimited text. Handles quotes, CRLF, preserves empty data rows (only trims trailing). */
function parseDelimited(text: string, delimiter: string): string[][] {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  // Trim only trailing empty lines
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  if (lines.length === 0) return [];

  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

const styles = StyleSheet.create({
  scrollH: { flex: 1 },
  scrollV: { flex: 1, maxHeight: 500 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#44403c',
  },
  rowAlt: { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
  headerRow: {
    backgroundColor: '#292524',
    borderBottomWidth: 1,
    borderBottomColor: '#44403c',
  },
  cell: {
    minWidth: 100,
    maxWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#44403c',
  },
  headerCell: {},
  headerText: { fontSize: 12, fontWeight: '700', color: '#fafaf9' },
  cellText: { fontSize: 12, color: '#d6d3d1' },
  empty: { padding: 32, textAlign: 'center', color: '#78716c', fontSize: 14 },
});
