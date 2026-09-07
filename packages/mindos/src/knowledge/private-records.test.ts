import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPrivateRecord, writePrivateRecord } from './private-records.js';

let home: string;
let root: string;
const name = 'methodcheck-' + 'a'.repeat(24) + '.json';
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'private-record-bound-'));
  root = path.join(home, 'mind');
  fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
it('saves a Unicode record exactly at its byte budget and reads it back', () => {
  const value = { reason: '边界🧪' };
  const bytes = Buffer.byteLength(JSON.stringify(value, null, 2));
  writePrivateRecord(root, name, value, bytes);
  expect(readPrivateRecord(root, name, bytes)).toEqual(value);
});
it('rejects an oversized replacement before publishing and preserves the readable old record', () => {
  const original = { reason: 'old' };
  writePrivateRecord(root, name, original, 100);
  expect(() => writePrivateRecord(root, name, { reason: '界'.repeat(40) }, 100)).toThrow();
  expect(readPrivateRecord(root, name, 100)).toEqual(original);
});
it('does not create an unreadable record when the first write exceeds its budget', () => {
  expect(() => writePrivateRecord(root, name, { reason: 'large' }, 1)).toThrow();
  expect(readPrivateRecord(root, name, 100)).toBeNull();
});
it('accepts bounded study records without accepting paths or arbitrary private file names', () => {
  const study = 'study-' + 'b'.repeat(24) + '.json';
  writePrivateRecord(root, study, { fixture: true }, 100);
  expect(readPrivateRecord(root, study, 100)).toEqual({ fixture: true });
  for (const invalid of ['../' + study, 'study-anything.json', 'secret.json'])
    expect(() => writePrivateRecord(root, invalid, {}, 100)).toThrow();
});
