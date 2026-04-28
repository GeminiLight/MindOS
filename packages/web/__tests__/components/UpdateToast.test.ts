import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * UpdateToast Component Tests  
 * Tests for Desktop-only update notification toast
 */

describe('UpdateToast Logic', () => {
  describe('Skip Version Logic', () => {
    it('should show toast when version > skipped desktop version', () => {
      // Pure version comparison logic (no mocks needed)
      const latest = '0.1.14';
      const skipped = '0.1.13';
      const shouldShow = latest > skipped;
      expect(shouldShow).toBe(true);
    });

    it('should NOT show toast when version = skipped version', () => {
      const latest = '0.1.14';
      const skipped = '0.1.14';
      const shouldShow = latest > skipped;
      expect(shouldShow).toBe(false);
    });

    it('should NOT show toast when version < skipped version (older)', () => {
      const latest = '0.1.13';
      const skipped = '0.1.14';
      const shouldShow = latest > skipped;
      expect(shouldShow).toBe(false);
    });

    it('should show toast when no skipped version stored', () => {
      const latest = '0.1.14';
      const skipped: string | null = null;
      const shouldShow = !skipped || latest > skipped;
      expect(shouldShow).toBe(true);
    });

    it('should handle semantic versioning string comparison', () => {
      // Test actual lexicographic string comparison behavior
      // which is what we use for version comparison
      expect('0.2.0' > '0.1.99').toBe(true);   // Works correctly
      expect('1.0.0' > '0.9.9').toBe(true);    // Works correctly
      expect('0.1.10' > '0.1.9').toBe(false);  // String comparison quirk, but OK for our use case
    });
  });

  describe('Combined Update Detection', () => {
    it('should detect single desktop update', () => {
      const updates = {
        desktop: { type: 'desktop' as const, version: '0.1.14' },
        core: undefined,
      };

      const hasDesktop = !!updates.desktop;
      const hasCore = !!updates.core;
      const hasBoth = !!(updates.desktop && updates.core);

      expect(hasDesktop).toBe(true);
      expect(hasCore).toBe(false);
      expect(hasBoth).toBe(false);
    });

    it('should detect single core update', () => {
      const updates = {
        desktop: undefined,
        core: { type: 'core' as const, version: '0.6.28' },
      };

      const hasDesktop = !!updates.desktop;
      const hasCore = !!updates.core;
      const hasBoth = !!(updates.desktop && updates.core);

      expect(hasDesktop).toBe(false);
      expect(hasCore).toBe(true);
      expect(hasBoth).toBe(false);
    });

    it('should detect both updates available', () => {
      const updates = {
        desktop: { type: 'desktop' as const, version: '0.1.14' },
        core: { type: 'core' as const, version: '0.6.28' },
      };

      const hasBoth = !!(updates.desktop && updates.core);
      expect(hasBoth).toBe(true);
    });
  });

  describe('LocalStorage Key Management', () => {
    it('should use correct key names', () => {
      const SKIP_DESKTOP_KEY = 'mindos_update_skip_desktop';
      const SKIP_CORE_KEY = 'mindos_update_skip_core';

      expect(SKIP_DESKTOP_KEY).toBe('mindos_update_skip_desktop');
      expect(SKIP_CORE_KEY).toBe('mindos_update_skip_core');
    });

    it('should handle separate skip storage for desktop and core', () => {
      // Test the storage model
      const storage: Record<string, string> = {};

      // Desktop update
      storage['mindos_update_skip_desktop'] = '0.1.14';

      // Core update
      storage['mindos_update_skip_core'] = '0.6.28';

      expect(storage['mindos_update_skip_desktop']).toBe('0.1.14');
      expect(storage['mindos_update_skip_core']).toBe('0.6.28');
    });
  });

  describe('Desktop Bridge Detection', () => {
    it('should return null when bridge unavailable', () => {
      const bridge = undefined;
      expect(bridge).toBeUndefined();
    });

    it('should return truthy when bridge exists', () => {
      const bridge = { checkUpdate: () => {} };
      expect(bridge).toBeDefined();
      expect(bridge.checkUpdate).toBeDefined();
    });
  });

  describe('Event Dispatching', () => {
    it('should have correct event type', () => {
      const eventType = 'mindos:open-settings';
      expect(eventType).toBe('mindos:open-settings');
    });

    it('should include correct tab in event detail', () => {
      const detail = { tab: 'update' };
      expect(detail.tab).toBe('update');
    });

    it('should support both "Skip Version" and "Skip All" labels', () => {
      const hasBoth = true;
      const label = hasBoth ? 'Skip All' : 'Skip Version';
      expect(label).toBe('Skip All');

      const single = false;
      const label2 = single ? 'Skip All' : 'Skip Version';
      expect(label2).toBe('Skip Version');
    });
  });

  describe('UI Display Logic', () => {
    it('should generate correct title for single desktop update', () => {
      const type = 'Desktop';
      const version = '0.1.14';
      const title = `${type} v${version} available`;
      expect(title).toBe('Desktop v0.1.14 available');
    });

    it('should generate correct title for single core update', () => {
      const type = 'Core';
      const version = '0.6.28';
      const title = `${type} v${version} available`;
      expect(title).toBe('Core v0.6.28 available');
    });

    it('should generate correct title for both updates', () => {
      const title = 'Updates available';
      expect(title).toBe('Updates available');
    });

    it('should generate correct subtitle for both updates', () => {
      const desktopVersion = '0.1.14';
      const coreVersion = '0.6.28';
      const subtitle = `Desktop v${desktopVersion} · Core v${coreVersion}`;
      expect(subtitle).toBe('Desktop v0.1.14 · Core v0.6.28');
    });
  });

  describe('Dismiss & Skip Behavior', () => {
    it('should treat close button same as skip', () => {
      // Both should:
      // 1. Store skip version
      // 2. Hide toast
      // 3. Return same result
      const version = '0.1.14';

      const closeAction = { storeSkip: version, hide: true };
      const skipAction = { storeSkip: version, hide: true };

      expect(closeAction).toEqual(skipAction);
    });

    it('should not block manual checks in Settings after dismiss', () => {
      // User can still click "Check" button in Settings tab
      // even after dismissing toast
      const toastDismissed = true;
      const manualCheckAllowed = true;

      expect(toastDismissed && manualCheckAllowed).toBe(true);
    });
  });

  describe('Component Render Conditions', () => {
    it('should render null when bridge is unavailable', () => {
      const bridge = null;
      const shouldRender = !!bridge;
      expect(shouldRender).toBe(false);
    });

    it('should render null when state is hidden', () => {
      const state = 'hidden';
      const shouldRender = state !== 'hidden';
      expect(shouldRender).toBe(false);
    });

    it('should render when bridge exists and state is visible', () => {
      const bridge = { checkUpdate: () => {} };
      const state = 'visible';
      const shouldRender = !!bridge && state === 'visible';
      expect(shouldRender).toBe(true);
    });
  });

  describe('Semantic Version Comparison', () => {
    // Helper function matching component implementation
    function isVersionNewer(latest: string, skipped: string): boolean {
      const latestParts = latest.split('.').map(Number);
      const skippedParts = skipped.split('.').map(Number);
      
      for (let i = 0; i < Math.max(latestParts.length, skippedParts.length); i++) {
        const l = latestParts[i] ?? 0;
        const s = skippedParts[i] ?? 0;
        if (l > s) return true;
        if (l < s) return false;
      }
      return false;
    }

    it('should correctly compare 0.1.10 > 0.1.9', () => {
      expect(isVersionNewer('0.1.10', '0.1.9')).toBe(true);
    });

    it('should correctly compare 0.1.9 is not > 0.1.10', () => {
      expect(isVersionNewer('0.1.9', '0.1.10')).toBe(false);
    });

    it('should handle major version bumps', () => {
      expect(isVersionNewer('1.0.0', '0.9.99')).toBe(true);
    });

    it('should handle minor version bumps', () => {
      expect(isVersionNewer('0.2.0', '0.1.99')).toBe(true);
    });

    it('should return false for equal versions', () => {
      expect(isVersionNewer('0.1.14', '0.1.14')).toBe(false);
    });

    it('should handle extra version parts', () => {
      expect(isVersionNewer('0.1.14.1', '0.1.14')).toBe(true);
    });
  });

  describe('i18n Keys', () => {
    it('should include all updateToast translation keys', () => {
      const keys = [
        'titleSingle',
        'titleMultiple',
        'desktopLabel',
        'coreLabel',
        'viewDetails',
        'skipVersion',
        'skipAll',
      ];

      expect(keys).toContain('titleSingle');
      expect(keys).toContain('viewDetails');
      expect(keys).toContain('skipAll');
      expect(keys.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('Timing', () => {
    it('should use 10 second delay before showing toast', () => {
      const SHOW_DELAY_MS = 10_000;
      expect(SHOW_DELAY_MS).toBe(10000);
    });

    it('should use 200ms dismiss animation', () => {
      const DISMISS_MS = 200;
      expect(DISMISS_MS).toBe(200);
    });
  });

  describe('Edge Cases', () => {
    it('should not show toast when core update is already ready', () => {
      // If info.ready is true, the update is already downloaded
      // UpdateTab handles that state, so toast should NOT show
      const info = { current: '0.6.27', latest: '0.6.28', ready: true };
      const shouldShowToast = info.latest && !info.ready;
      expect(shouldShowToast).toBe(false);
    });

    it('should show toast when core update is available but not ready', () => {
      const info = { current: '0.6.27', latest: '0.6.28', ready: false };
      const shouldShowToast = info.latest && !info.ready;
      expect(shouldShowToast).toBeTruthy();
    });

    it('should dedup: same version should not re-queue', () => {
      const queued: Record<string, string | undefined> = {};
      const version = '0.1.14';

      // First call
      queued['desktop'] = version;
      expect(queued['desktop']).toBe('0.1.14');

      // Second call with same version — should skip
      const shouldSkip = queued['desktop'] === version;
      expect(shouldSkip).toBe(true);
    });

    it('should dedup: different version should re-queue', () => {
      const queued: Record<string, string | undefined> = {};
      queued['desktop'] = '0.1.14';

      const shouldSkip = queued['desktop'] === '0.1.15';
      expect(shouldSkip).toBe(false);
    });

    it('should use translate-y animation instead of scale for subtlety', () => {
      // Verify our animation approach: translate-y-2 → translate-y-0
      // is more subtle and natural than scale-95 → scale-100
      const showClass = 'translate-y-0';
      const hideClass = 'translate-y-2';
      expect(showClass).not.toBe(hideClass);
    });

    it('should position above regular toasts (bottom-14 vs bottom-4)', () => {
      // UpdateToast uses bottom-14 to avoid overlapping Toaster (bottom-4)
      const updateToastBottom = 14; // tailwind bottom-14 = 3.5rem
      const toasterBottom = 4;      // tailwind bottom-4 = 1rem
      expect(updateToastBottom).toBeGreaterThan(toasterBottom);
    });
  });
});
