import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildObsidianNativeQueryIndex,
  queryObsidianNativeNotes,
  queryObsidianNativeTasks,
} from '@/lib/obsidian-compat/native-query-index';
import { MetadataCacheShim } from '@/lib/obsidian-compat/shims/metadata-cache';
import { Vault } from '@/lib/obsidian-compat/shims/vault';

let mindRoot: string;
let vault: Vault;
let metadataCache: MetadataCacheShim;

describe('Obsidian native query index', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-native-query-'));
    vault = new Vault(mindRoot);
    metadataCache = new MetadataCacheShim(mindRoot, vault);
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('indexes Markdown notes, metadata, links, headings, and read-only task records', async () => {
    await vault.create('Projects/alpha.md', `---
title: Alpha
status: active
tags: [project, "#area/work"]
---

# Alpha

Body links [[Reference]] and [Spec](Specs/spec.md) with #body-tag.

- [ ] Ship native query #project ^ship-task
- [x] Archive imported report
  - [ ] Follow up child #child
`);
    await vault.create('Reference.md', '# Reference');
    await vault.create('Specs/spec.md', '# Spec');
    await vault.create('Assets/image.png.md.backup', 'not markdown');
    fs.mkdirSync(path.join(mindRoot, '.mindos'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.mindos/private.md'), '# Private');

    const index = await buildObsidianNativeQueryIndex({ vault, metadataCache });
    const alpha = index.notes.find((note) => note.path === 'Projects/alpha.md');

    expect(index.stats).toEqual({
      noteCount: 3,
      taskCount: 3,
      completedTaskCount: 1,
      incompleteTaskCount: 2,
    });
    expect(index.notes.map((note) => note.path)).toEqual([
      'Projects/alpha.md',
      'Reference.md',
      'Specs/spec.md',
    ]);
    expect(alpha).toMatchObject({
      basename: 'alpha',
      frontmatter: {
        title: 'Alpha',
        status: 'active',
        tags: ['project', '#area/work'],
      },
      frontmatterTags: ['#project', '#area/work'],
      bodyTags: ['#body-tag', '#project', '#child'],
      tags: ['#project', '#area/work', '#body-tag', '#child'],
      headings: [{ heading: 'Alpha', level: 1, line: 6 }],
    });
    expect(alpha?.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ link: 'Reference', original: '[[Reference]]' }),
      expect.objectContaining({ link: 'Specs/spec', original: '[Spec](Specs/spec.md)' }),
    ]));
    expect(alpha?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        line: 10,
        status: ' ',
        completed: false,
        text: 'Ship native query #project',
        rawText: 'Ship native query #project ^ship-task',
        blockId: 'ship-task',
        tags: ['#project'],
        noteTags: ['#project', '#area/work', '#body-tag'],
        effectiveTags: ['#project', '#area/work', '#body-tag'],
      }),
      expect.objectContaining({
        line: 11,
        status: 'x',
        completed: true,
        text: 'Archive imported report',
      }),
    ]));
    expect(index.proof).toMatchObject({
      status: 'native-replacement',
      limitations: expect.arrayContaining([
        'Does not execute official Dataview or Tasks plugin runtime code.',
        'Does not parse full Dataview DQL or DataviewJS.',
      ]),
    });
  });

  it('filters notes and tasks through a limited Dataview/Tasks-style native subset', async () => {
    await vault.create('Projects/alpha.md', `---
status: active
tags: [project]
---

- [ ] Ship native query #work
- [x] Done task #work
`);
    await vault.create('Projects/beta.md', `---
status: paused
tags: [project]
---

- [ ] Paused task
`);
    await vault.create('Inbox/today.md', `---
status: active
---

- [ ] Inbox task #work
`);

    const index = await buildObsidianNativeQueryIndex({ vault, metadataCache });

    expect(queryObsidianNativeNotes(index, {
      pathPrefix: 'Projects/',
      tag: 'project',
      frontmatter: { status: 'active' },
    }).map((note) => note.path)).toEqual(['Projects/alpha.md']);
    expect(queryObsidianNativeTasks(index, {
      pathPrefix: 'Projects/',
      completed: false,
      tags: ['#project', '#work'],
      textIncludes: 'ship',
    }).map((task) => task.text)).toEqual(['Ship native query #work']);
    expect(queryObsidianNativeTasks(index, { completed: true }).map((task) => task.text)).toEqual([
      'Done task #work',
    ]);
  });

  it('handles empty vaults and malformed frontmatter without broad runtime assumptions', async () => {
    let index = await buildObsidianNativeQueryIndex({ vault, metadataCache });
    expect(index.notes).toEqual([]);
    expect(index.tasks).toEqual([]);

    await vault.create('broken.md', `---
title: [unterminated
---

- [ ] Still visible #fallback
`);
    index = await buildObsidianNativeQueryIndex({ vault, metadataCache });

    expect(index.notes[0]).toMatchObject({
      path: 'broken.md',
      tags: ['#fallback'],
    });
    expect(index.notes[0]).not.toHaveProperty('frontmatter');
    expect(queryObsidianNativeTasks(index, { tag: 'fallback', completed: false })).toHaveLength(1);
  });
});
