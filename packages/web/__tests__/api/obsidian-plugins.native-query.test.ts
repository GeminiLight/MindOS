import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  importNativeQueryRoute,
  installObsidianPluginApiHarness,
  nativeQueryGetRequest,
  writePlugin,
} from './obsidian-plugin-api-test-utils';

let mindRoot: string;

function writeVaultFile(relativePath: string, content: string) {
  const targetPath = path.join(mindRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf-8');
}

describe('/api/obsidian-plugins/native-query', () => {
  installObsidianPluginApiHarness((root) => {
    mindRoot = root;
  });

  it('returns a bounded read-only native query preview for Dataview-style plugins', async () => {
    writePlugin(
      'dataview',
      `const { Plugin } = require('obsidian'); module.exports = class DataviewPlugin extends Plugin {};`,
      { name: 'Dataview' },
    );
    writeVaultFile('Alpha.md', [
      '---',
      'title: Alpha',
      'status: active',
      'tags: [project, obsidian]',
      '---',
      '# Alpha',
      'See [[Beta]].',
      '- [ ] Ship native preview #next ^ship',
      '- [x] Archive done #done',
      '',
    ].join('\n'));
    writeVaultFile('Beta.md', [
      '---',
      'title: Beta',
      'status: waiting',
      '---',
      '# Beta',
      '#reference',
      '',
    ].join('\n'));
    writeVaultFile('.mindos/private.md', '- [ ] Do not index private control-plane files #secret\n');

    const { GET } = await importNativeQueryRoute();
    const res = await GET(nativeQueryGetRequest({ pluginId: 'dataview' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      pluginId: 'dataview',
      proof: {
        status: 'native-replacement',
        limitations: expect.arrayContaining([
          expect.stringContaining('Does not execute official Dataview or Tasks plugin runtime code.'),
        ]),
      },
      stats: {
        noteCount: 2,
        taskCount: 2,
        completedTaskCount: 1,
        incompleteTaskCount: 1,
      },
      sampleLimits: {
        notes: 5,
        tasks: 8,
      },
    });
    expect(json.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Alpha.md',
        frontmatter: {
          title: 'Alpha',
          status: 'active',
        },
        taskCount: 2,
        incompleteTaskCount: 1,
        linkCount: 1,
        headingCount: 1,
      }),
    ]));
    expect(json.notes.map((note: { path: string }) => note.path)).not.toContain('.mindos/private.md');
    expect(json.tasks).toEqual([
      expect.objectContaining({
        path: 'Alpha.md',
        line: 7,
        completed: false,
        text: 'Ship native preview #next',
        effectiveTags: expect.arrayContaining(['#project', '#obsidian', '#next']),
      }),
    ]);
  });

  it('rejects plugins without a native query replacement audit', async () => {
    writePlugin(
      'simple-plugin',
      `const { Plugin } = require('obsidian'); module.exports = class SimplePlugin extends Plugin {};`,
      { name: 'Simple Plugin' },
    );

    const { GET } = await importNativeQueryRoute();
    const res = await GET(nativeQueryGetRequest({ pluginId: 'simple-plugin' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Native query preview is not available');
  });
});
