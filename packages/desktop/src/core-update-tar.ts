/**
 * tar.gz extraction for Core updates.
 *
 * Split out of core-updater.ts. A pure-JS parser on every platform, because
 * the two properties that matter cannot be left to whatever `tar` a machine
 * happens to have: entries that escape the destination (`../`, absolute
 * paths, Windows drive prefixes) are rejected, and long Windows paths go
 * through the `\\?\` prefix instead of failing at 260 characters.
 */
import path from 'path';
import { chmodSync, createReadStream, mkdirSync, writeFileSync } from 'fs';
import { createGunzip } from 'zlib';

/**
 * Extract a tar.gz archive.
 *
 * Uses a pure-JS implementation (Node zlib + minimal tar parser) on every
 * platform so traversal rejection and long-path handling stay consistent.
 */
export function extractTarGz(tarball: string, destDir: string): Promise<void> {
  return extractTarGzJs(tarball, destDir);
}

/**
 * Pure-JS tar.gz extraction using Node built-in zlib.
 * Handles both POSIX ustar and GNU tar formats (512-byte header blocks).
 * GNU tar uses @LongLink (typeflag 'L') / @LongName (typeflag 'K') extensions
 * for paths exceeding the 100-byte name field. POSIX pax uses typeflag 'x'.
 * Uses \\?\ long-path prefix on Windows to bypass 260-char limit.
 */
async function extractTarGzJs(tarball: string, destDir: string): Promise<void> {
  // Read & decompress the entire file into memory.
  // Runtime tarballs are ~32 MB compressed, ~125 MB decompressed — fits in memory.
  const buf = await decompressGzip(tarball);

  let offset = 0;
  // GNU long-name extensions: the next entry's name/link is stored in a preceding
  // pseudo-entry with typeflag 'L' (long name) or 'K' (long link target).
  let gnuLongName: string | null = null;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    offset += 512;

    // Two consecutive zero blocks = end of archive
    if (header.every(b => b === 0)) break;

    // Parse tar header fields
    const nameRaw = readTarString(header, 0, 100);
    const mode = parseInt(readTarString(header, 100, 8), 8) || 0;
    const sizeOctal = readTarString(header, 124, 12);
    const typeflag = header[156];
    const prefix = readTarString(header, 345, 155);

    const fileSize = parseInt(sizeOctal, 8) || 0;
    if (offset + fileSize > buf.length) {
      throw new Error('Truncated tar archive: entry data exceeds archive size');
    }

    // Data blocks (rounded up to 512-byte boundary)
    const dataBlocks = Math.ceil(fileSize / 512) * 512;

    // ── GNU typeflag 'L' (0x4c): long file name for the next entry ──
    if (typeflag === 0x4c) {
      gnuLongName = buf.subarray(offset, offset + fileSize).toString('utf-8').replace(/\0+$/, '');
      offset += dataBlocks;
      continue;
    }

    // ── GNU typeflag 'K' (0x4b): long link target for the next entry ──
    // Skipped, not stored: link entries are rejected outright below, so the
    // target is never needed. (It used to be parsed into a variable nobody read.)
    if (typeflag === 0x4b) {
      offset += dataBlocks;
      continue;
    }

    // ── POSIX pax extended header (typeflag 'x' = 0x78): skip data, may set name ──
    if (typeflag === 0x78) {
      // Parse pax headers to extract path if present
      const paxData = buf.subarray(offset, offset + fileSize).toString('utf-8');
      const pathMatch = paxData.match(/\d+ path=(.+)\n/);
      if (pathMatch) {
        gnuLongName = pathMatch[1];
      }
      offset += dataBlocks;
      continue;
    }

    // ── Global pax header (typeflag 'g' = 0x67) — skip ──
    if (typeflag === 0x67) {
      offset += dataBlocks;
      continue;
    }

    // Determine final entry name: GNU long name takes priority, then POSIX prefix+name
    let entryName: string;
    if (gnuLongName) {
      entryName = gnuLongName;
      gnuLongName = null; // Consumed — applies only to the immediately following entry
    } else {
      entryName = prefix ? `${prefix}/${nameRaw}` : nameRaw;
    }

    if (!entryName || entryName === '.' || entryName === './') {
      offset += dataBlocks;
      continue;
    }

    // typeflag '1' = hardlink, '2' = symlink. Runtime archives are built
    // symlink-free (scripts/build-runtime-archive.sh), so a link entry means a
    // corrupt or tampered archive — fail loudly instead of writing an empty file.
    if (typeflag === 0x31 || typeflag === 0x32) {
      throw new Error(`Unsupported tar link entry (typeflag '${String.fromCharCode(typeflag)}'): ${entryName}`);
    }

    // Resolve path, reject archive traversal, then apply Windows long-path prefix.
    const entryPath = resolveTarEntryPath(destDir, entryName);

    // typeflag: '5' (0x35) = directory, '0' (0x30) or 0 (NUL) = regular file
    const isDir = typeflag === 0x35 || entryName.endsWith('/');

    if (isDir) {
      mkdirSync(entryPath, { recursive: true });
    } else {
      // Ensure parent directory exists
      const parentDir = path.dirname(entryPath);
      mkdirSync(parentDir, { recursive: true });

      // Write file content
      const content = buf.subarray(offset, offset + fileSize);
      writeFileSync(entryPath, content);
      if (process.platform !== 'win32' && mode) chmodSync(entryPath, mode & 0o777); // preserve executable bits; Windows has no chmod semantics
    }

    offset += dataBlocks;
  }
}

function resolveTarEntryPath(destDir: string, entryName: string): string {
  const normalizedEntryName = entryName.replace(/\\/g, '/');
  if (
    path.posix.isAbsolute(normalizedEntryName)
    || path.win32.isAbsolute(entryName)
    || path.win32.isAbsolute(normalizedEntryName)
    || hasWindowsDrivePrefix(entryName)
    || hasWindowsDrivePrefix(normalizedEntryName)
    || normalizedEntryName.split('/').includes('..')
  ) {
    throw new Error(`Tar entry outside extraction directory: ${entryName}`);
  }

  const destResolved = path.resolve(destDir);
  const entryPath = path.resolve(destResolved, normalizedEntryName);
  const relativeEntry = path.relative(destResolved, entryPath);
  if (
    relativeEntry === '..'
    || relativeEntry.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeEntry)
  ) {
    throw new Error(`Tar entry outside extraction directory: ${entryName}`);
  }

  return winLongPath(entryPath);
}

function hasWindowsDrivePrefix(filePath: string): boolean {
  return /^[A-Za-z]:/.test(filePath);
}

/** Decompress a .gz file into a Buffer using Node's built-in zlib. */
function decompressGzip(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const input = createReadStream(filePath);

    input.pipe(gunzip);
    gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    gunzip.on('end', () => resolve(Buffer.concat(chunks)));
    gunzip.on('error', (err) => reject(new Error(`gzip decompression failed: ${err.message}`)));
    input.on('error', (err) => reject(new Error(`reading tarball failed: ${err.message}`)));
  });
}

/** Read a NUL-terminated string from a tar header field. */
function readTarString(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const nulIdx = slice.indexOf(0);
  return slice.subarray(0, nulIdx === -1 ? length : nulIdx).toString('utf-8');
}

/** On Windows, prefix absolute paths with \\?\ to support paths > 260 chars. */
function winLongPath(p: string): string {
  if (process.platform !== 'win32') return p;
  // Already prefixed, or is a relative/UNC path
  if (p.startsWith('\\\\?\\') || !path.isAbsolute(p)) return p;
  return `\\\\?\\${p}`;
}

/** Exported for testing. */
export {
  extractTarGz as _extractTarGz_forTest,
  extractTarGzJs as _extractTarGzJs_forTest,
};
