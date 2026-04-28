import { describe, it, expect } from 'vitest';
import { validateManifest, ManifestError } from '@/lib/obsidian-compat/manifest';

describe('validateManifest', () => {
  it('accepts valid manifest', () => {
    const manifest = validateManifest({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
    });
    expect(manifest.id).toBe('test-plugin');
    expect(manifest.name).toBe('Test Plugin');
    expect(manifest.version).toBe('1.0.0');
  });

  it('throws on missing id', () => {
    expect(() =>
      validateManifest({
        name: 'Test Plugin',
        version: '1.0.0',
      }),
    ).toThrow(ManifestError);
  });

  it('throws on invalid id (contains spaces)', () => {
    expect(() =>
      validateManifest({
        id: 'test plugin',
        name: 'Test Plugin',
        version: '1.0.0',
      }),
    ).toThrow(ManifestError);
  });

  it('throws on invalid version', () => {
    expect(() =>
      validateManifest({
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0',
      }),
    ).toThrow(ManifestError);
  });

  it('accepts optional fields', () => {
    const manifest = validateManifest({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      author: 'Test Author',
      isDesktopOnly: true,
    });
    expect(manifest.description).toBe('A test plugin');
    expect(manifest.author).toBe('Test Author');
    expect(manifest.isDesktopOnly).toBe(true);
  });
});
