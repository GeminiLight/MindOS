/**
 * CSV utility functions for CLI.
 * Port of packages/web/lib/core/csv.ts logic (RFC 4180 escaping).
 */

/**
 * Escape and join values into a single CSV row string.
 * Follows RFC 4180: quote fields containing comma, double-quote, or newline.
 * @param {string[]} row
 * @returns {string} escaped CSV line (without trailing newline)
 */
export function escapeCsvRow(row) {
  return row.map(cell => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  }).join(',');
}
