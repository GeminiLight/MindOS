import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { removeMacQuarantineAttribute } from './node-bootstrap';

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(process.cwd(), 'tmp-node-bootstrap-home'),
  },
}));

describe('node-bootstrap', () => {
  it('removes macOS quarantine with argv so quoted paths are safe', () => {
    const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
    const nodeDir = '/Users/test/.mindos/node "quoted" $HOME';

    removeMacQuarantineAttribute(nodeDir, (command, args, options) => {
      calls.push({ command, args, options });
      return '';
    });

    expect(calls).toEqual([{
      command: 'xattr',
      args: ['-dr', 'com.apple.quarantine', nodeDir],
      options: { stdio: 'ignore' },
    }]);

    const source = readFileSync(path.join(__dirname, 'node-bootstrap.ts'), 'utf-8');
    expect(source).not.toContain('execSync(`xattr');
    expect(source).not.toContain('com.apple.quarantine "${NODE_DIR}"');
  });
});
