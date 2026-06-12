// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Messages } from '@/lib/i18n';

/**
 * The locale store statically bundles only the default locale (en).
 * zh arrives either synchronously (registered by the server-selected
 * LocaleStoreInitZh client component before the store is read) or via
 * a dynamic import on locale switch.
 */
describe('locale store lazy locale loading', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  async function loadStore() {
    return import('@/lib/stores/locale-store');
  }

  it('resolves default-locale strings synchronously without loading zh', async () => {
    const { useLocaleStore } = await loadStore();
    const { en } = await import('@/lib/i18n/messages-en');
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(useLocaleStore.getState().t).toBe(en);
  });

  it('applies a registered zh bundle synchronously for SSR alignment (no async gap)', async () => {
    const { registerMessages, applySsrLocale, useLocaleStore } = await loadStore();
    const fakeZh = { common: { hello: '你好' } } as unknown as Messages;
    registerMessages('zh', fakeZh);
    applySsrLocale('zh');
    // Synchronous: the very next read sees zh — required so the first client
    // render matches zh SSR HTML (no hydration mismatch, no language flash).
    expect(useLocaleStore.getState().locale).toBe('zh');
    expect(useLocaleStore.getState().t).toBe(fakeZh);
  });

  it('setLocale("zh") lazy-loads the zh bundle and swaps locale and strings atomically', async () => {
    const { useLocaleStore } = await loadStore();
    const { en } = await import('@/lib/i18n/messages-en');

    useLocaleStore.getState().setLocale('zh');
    // Until the chunk resolves, the store keeps showing the previous locale
    // in full (no mixed-language intermediate state).
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(useLocaleStore.getState().t).toBe(en);

    await vi.waitFor(() => {
      expect(useLocaleStore.getState().locale).toBe('zh');
    });
    const { zh } = await import('@/lib/i18n/messages-zh');
    expect(useLocaleStore.getState().t).toBe(zh as unknown as Messages);
    expect(document.documentElement.lang).toBe('zh');
  });

  it('a stale zh load never overwrites a newer en choice (rapid toggle)', async () => {
    const { useLocaleStore } = await loadStore();
    const { en } = await import('@/lib/i18n/messages-en');

    useLocaleStore.getState().setLocale('zh');
    useLocaleStore.getState().setLocale('en');

    // Let the zh dynamic import settle, then confirm en won.
    await import('@/lib/i18n/messages-zh');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useLocaleStore.getState().locale).toBe('en');
    expect(useLocaleStore.getState().t).toBe(en);
  });

  it('switching to an already-loaded locale applies synchronously', async () => {
    const { useLocaleStore } = await loadStore();

    useLocaleStore.getState().setLocale('zh');
    await vi.waitFor(() => expect(useLocaleStore.getState().locale).toBe('zh'));

    const { en } = await import('@/lib/i18n/messages-en');
    useLocaleStore.getState().setLocale('en');
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(useLocaleStore.getState().t).toBe(en);

    // zh is now cached — switching back is synchronous too.
    useLocaleStore.getState().setLocale('zh');
    expect(useLocaleStore.getState().locale).toBe('zh');
  });
});
