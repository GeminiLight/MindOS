import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile, testMindRoot } from '../setup';
import { GET, POST } from '../../app/api/file/route';
import { invalidateCache } from '../../lib/fs';
import fs from 'fs';
import path from 'path';

// Helper to get testMindRoot at call time (not import time)
function root() {
  return testMindRoot;
}

describe('GET /api/file', () => {
  it('returns error when path is missing', async () => {
    const req = new NextRequest('http://localhost/api/file');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing path');
  });

  it('list_spaces returns top-level spaces without path param', async () => {
    seedFile('LSpace/note.md', 'x');
    seedFile('LSpace/README.md', '# L\n\nhello space');
    invalidateCache();
    const req = new NextRequest('http://localhost/api/file?op=list_spaces');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.spaces)).toBe(true);
    const ls = body.spaces as Array<{ path: string; description: string; fileCount: number }>;
    const found = ls.find((s) => s.path === 'LSpace' || s.path.endsWith('LSpace'));
    expect(found).toBeTruthy();
    expect(found?.fileCount).toBeGreaterThanOrEqual(1);
    expect(found?.description).toContain('hello space');
  });

  it('reads file content (default op=read_file)', async () => {
    seedFile('hello.md', '# Hello World');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/file?path=hello.md');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe('# Hello World');
  });

  it('reads file lines (op=read_lines)', async () => {
    seedFile('lines.md', 'line0\nline1\nline2');
    invalidateCache();

    const req = new NextRequest('http://localhost/api/file?path=lines.md&op=read_lines');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lines).toEqual(['line0', 'line1', 'line2']);
  });

  it('returns 500 for non-existent file', async () => {
    const req = new NextRequest('http://localhost/api/file?path=nope.md');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/file', () => {
  function post(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/file', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('returns error for missing op', async () => {
    const res = await POST(post({ path: 'x.md' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing op');
  });

  it('returns error for missing path', async () => {
    const res = await POST(post({ op: 'save_file' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing path');
  });

  it('returns error for unknown op', async () => {
    const res = await POST(post({ op: 'unknown_op', path: 'x.md' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('unknown op');
  });

  it('save_file creates and writes content', async () => {
    const res = await POST(post({ op: 'save_file', path: 'new.md', content: 'hello' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify on disk
    const content = fs.readFileSync(path.join(root(), 'new.md'), 'utf-8');
    expect(content).toBe('hello');
  });

  it('save_file records a structured change event in JSON log', async () => {
    const res = await POST(post({ op: 'save_file', path: 'logged.md', content: 'v1' }));
    expect(res.status).toBe(200);

    const logPath = path.join(root(), '.mindos', 'change-log.json');
    expect(fs.existsSync(logPath)).toBe(true);

    const log = JSON.parse(fs.readFileSync(logPath, 'utf-8')) as {
      events: Array<{ op: string; path: string; after?: string }>;
    };
    expect(Array.isArray(log.events)).toBe(true);
    expect(log.events.length).toBeGreaterThan(0);
    expect(log.events[0].op).toBe('save_file');
    expect(log.events[0].path).toBe('logged.md');
    expect(log.events[0].after).toContain('v1');
  });

  it('save_file returns error if content missing', async () => {
    const res = await POST(post({ op: 'save_file', path: 'x.md' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing content');
  });

  it('delete_file removes a file', async () => {
    seedFile('to-delete.md', 'bye');
    invalidateCache();

    const res = await POST(post({ op: 'delete_file', path: 'to-delete.md' }));
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(root(), 'to-delete.md'))).toBe(false);
  });

  it('rename_file renames a file', async () => {
    seedFile('old-name.md', 'content');
    invalidateCache();

    const res = await POST(post({ op: 'rename_file', path: 'old-name.md', new_name: 'new-name.md' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.newPath).toBe('new-name.md');
    expect(fs.existsSync(path.join(root(), 'new-name.md'))).toBe(true);
    expect(fs.existsSync(path.join(root(), 'old-name.md'))).toBe(false);
  });

  it('rename_file returns error if new_name is missing', async () => {
    seedFile('x.md', 'content');
    invalidateCache();
    const res = await POST(post({ op: 'rename_file', path: 'x.md' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing new_name');
  });

  it('insert_lines inserts lines after index', async () => {
    seedFile('insert.md', 'line0\nline1\nline2');
    invalidateCache();

    const res = await POST(post({
      op: 'insert_lines',
      path: 'insert.md',
      after_index: 0,
      lines: ['inserted'],
    }));
    expect(res.status).toBe(200);

    const content = fs.readFileSync(path.join(root(), 'insert.md'), 'utf-8');
    expect(content).toBe('line0\ninserted\nline1\nline2');
  });

  it('insert_lines returns error if lines not array', async () => {
    seedFile('x.md', 'a');
    invalidateCache();
    const res = await POST(post({ op: 'insert_lines', path: 'x.md', after_index: 0, lines: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('update_lines replaces line range', async () => {
    seedFile('update.md', 'a\nb\nc\nd');
    invalidateCache();

    const res = await POST(post({
      op: 'update_lines',
      path: 'update.md',
      start: 1,
      end: 2,
      lines: ['B', 'C'],
    }));
    expect(res.status).toBe(200);

    const content = fs.readFileSync(path.join(root(), 'update.md'), 'utf-8');
    expect(content).toBe('a\nB\nC\nd');
  });

  it('update_lines validates start <= end', async () => {
    seedFile('x.md', 'a\nb');
    invalidateCache();
    const res = await POST(post({ op: 'update_lines', path: 'x.md', start: 2, end: 0, lines: ['x'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('start must be <= end');
  });

  it('insert_after_heading inserts content after heading', async () => {
    seedFile('heading.md', '# Title\n\nOld content\n\n## Other');
    invalidateCache();

    const res = await POST(post({
      op: 'insert_after_heading',
      path: 'heading.md',
      heading: '# Title',
      content: 'New line',
    }));
    expect(res.status).toBe(200);

    const content = fs.readFileSync(path.join(root(), 'heading.md'), 'utf-8');
    expect(content).toContain('New line');
  });

  it('update_section replaces section content', async () => {
    seedFile('section.md', '# Title\n\nOld stuff\n\n# Other\n\nKeep');
    invalidateCache();

    const res = await POST(post({
      op: 'update_section',
      path: 'section.md',
      heading: '# Title',
      content: 'Replaced',
    }));
    expect(res.status).toBe(200);

    const content = fs.readFileSync(path.join(root(), 'section.md'), 'utf-8');
    expect(content).toContain('Replaced');
    expect(content).toContain('# Other');
    expect(content).toContain('Keep');
  });

  it('append_to_file appends content', async () => {
    seedFile('append.md', 'existing');
    invalidateCache();

    const res = await POST(post({
      op: 'append_to_file',
      path: 'append.md',
      content: 'appended',
    }));
    expect(res.status).toBe(200);

    const content = fs.readFileSync(path.join(root(), 'append.md'), 'utf-8');
    expect(content).toContain('existing');
    expect(content).toContain('appended');
  });

  it('append_to_file transparently migrates legacy .agent-log.json writes into .mindos/agent-audit-log.json', async () => {
    invalidateCache();
    const line = JSON.stringify({
      ts: '2026-03-25T12:00:00.000Z',
      tool: 'mindos_search_notes',
      params: { query: 'agent' },
      result: 'ok',
      message: '1 result',
    }) + '\n';

    const res = await POST(post({
      op: 'append_to_file',
      path: '.agent-log.json',
      content: line,
    }));
    expect(res.status).toBe(200);

    const newLogPath = path.join(root(), '.mindos', 'agent-audit-log.json');
    expect(fs.existsSync(newLogPath)).toBe(true);
    const json = JSON.parse(fs.readFileSync(newLogPath, 'utf-8')) as {
      events: Array<{ tool: string; op: string }>;
    };
    expect(json.events.length).toBeGreaterThan(0);
    expect(json.events[0].tool).toBe('mindos_search_notes');
    expect(json.events[0].op).toBe('append');
    expect(fs.existsSync(path.join(root(), '.agent-log.json'))).toBe(false);
  });

  it('create_file creates a new file', async () => {
    invalidateCache();
    const res = await POST(post({
      op: 'create_file',
      path: 'new-file.md',
      content: '# New',
    }));
    expect(res.status).toBe(200);
    const content = fs.readFileSync(path.join(root(), 'new-file.md'), 'utf-8');
    expect(content).toBe('# New');
  });

  it('create_file with no content creates empty file', async () => {
    invalidateCache();
    const res = await POST(post({
      op: 'create_file',
      path: 'empty.md',
    }));
    expect(res.status).toBe(200);
    const content = fs.readFileSync(path.join(root(), 'empty.md'), 'utf-8');
    expect(content).toBe('');
  });

  it('move_file moves a file and returns affected files', async () => {
    seedFile('src.md', '# Source');
    invalidateCache();

    const res = await POST(post({
      op: 'move_file',
      path: 'src.md',
      to_path: 'dest/moved.md',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.newPath).toBe('dest/moved.md');
    expect(fs.existsSync(path.join(root(), 'dest/moved.md'))).toBe(true);
    expect(fs.existsSync(path.join(root(), 'src.md'))).toBe(false);
  });

  it('move_file returns error for missing to_path', async () => {
    seedFile('x.md', 'x');
    invalidateCache();
    const res = await POST(post({ op: 'move_file', path: 'x.md' }));
    expect(res.status).toBe(400);
  });

  it('append_csv appends a row to CSV', async () => {
    seedFile('data.csv', 'name,value\n');
    invalidateCache();

    const res = await POST(post({
      op: 'append_csv',
      path: 'data.csv',
      row: ['hello', 'world'],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.newRowCount).toBe(2);

    const content = fs.readFileSync(path.join(root(), 'data.csv'), 'utf-8');
    expect(content).toContain('hello,world');
  });

  it('append_csv validates row parameter', async () => {
    seedFile('data.csv', 'h\n');
    invalidateCache();
    const res = await POST(post({ op: 'append_csv', path: 'data.csv', row: [] }));
    expect(res.status).toBe(400);
  });

  it('create_space creates README and INSTRUCTION for new space', async () => {
    invalidateCache();
    const res = await POST(
      post({
        op: 'create_space',
        path: '_',
        name: 'ApiSpace',
        description: 'from api test',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.path).toBe('ApiSpace');
    expect(fs.existsSync(path.join(root(), 'ApiSpace', 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(root(), 'ApiSpace', 'INSTRUCTION.md'))).toBe(true);
  });

  it('create_space returns error for empty name', async () => {
    const res = await POST(post({ op: 'create_space', path: '_', name: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing or empty name');
  });

  it('rename_space renames a top-level directory', async () => {
    fs.mkdirSync(path.join(root(), 'RSOld'), { recursive: true });
    seedFile('RSOld/note.md', 'x');
    invalidateCache();
    const res = await POST(post({ op: 'rename_space', path: 'RSOld', new_name: 'RSNew' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(path.normalize(body.newPath as string)).toBe(path.normalize('RSNew'));
    expect(fs.existsSync(path.join(root(), 'RSNew', 'note.md'))).toBe(true);
  });

  it('rename_space rejects file path', async () => {
    seedFile('notadir.md', 'x');
    invalidateCache();
    const res = await POST(post({ op: 'rename_space', path: 'notadir.md', new_name: 'Y' }));
    expect(res.status).toBe(500);
  });
});
