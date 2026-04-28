import fs from 'fs';
import path from 'path';
import { resolveSafe } from './security';
import { MindOSError, ErrorCodes } from '@/lib/errors';

/**
 * Appends a single row to a CSV file with RFC 4180 escaping.
 * Creates parent directories if they don't exist.
 * Returns the new total row count.
 */
export function appendCsvRow(mindRoot: string, filePath: string, row: string[]): { newRowCount: number } {
  const resolved = resolveSafe(mindRoot, filePath);
  if (!filePath.endsWith('.csv')) throw new MindOSError(ErrorCodes.INVALID_FILE_TYPE, 'Only .csv files support row append', { filePath });

  const escaped = row.map((cell) => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  });
  const line = escaped.join(',') + '\n';

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, line, 'utf-8');

  const content = fs.readFileSync(resolved, 'utf-8');
  const newRowCount = content.trim().split('\n').length;
  return { newRowCount };
}
