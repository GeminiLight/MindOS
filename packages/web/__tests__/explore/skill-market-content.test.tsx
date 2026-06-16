// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillMarketContent from '@/components/explore/SkillMarketContent';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const skillCatalogResponse = {
  ok: true,
  skipped: [],
  cache: {
    state: 'refreshed',
    fetchedAt: '2026-06-16T00:00:00.000Z',
    ttlMs: 600000,
  },
  catalog: {
    source: {
      type: 'skills.sh',
      url: 'https://skills.sh/api/search',
    },
    query: 'agent',
    defaultedQuery: false,
    counts: {
      total: 3,
      returned: 3,
      installed: 1,
      available: 2,
      installable: 3,
    },
    skills: [
      {
        id: 'vercel-labs/agent-browser/agent-browser',
        skillId: 'agent-browser',
        name: 'agent-browser',
        source: 'skills.sh',
        sourceRepo: 'vercel-labs/agent-browser',
        repoUrl: 'https://github.com/vercel-labs/agent-browser',
        installs: 453923,
        installed: false,
        installable: true,
        installCommand: 'npx skills add vercel-labs/agent-browser --skill agent-browser',
      },
      {
        id: 'vercel-labs/agent-skills/web-design-guidelines',
        skillId: 'web-design-guidelines',
        name: 'web-design-guidelines',
        source: 'skills.sh',
        sourceRepo: 'vercel-labs/agent-skills',
        repoUrl: 'https://github.com/vercel-labs/agent-skills',
        installs: 394586,
        installed: true,
        installedEnabled: true,
        installedOrigin: 'agents-global',
        installable: true,
        installCommand: 'npx skills add vercel-labs/agent-skills --skill web-design-guidelines',
      },
      {
        id: 'xixu-me/skills/github-actions-docs',
        skillId: 'github-actions-docs',
        name: 'github-actions-docs',
        source: 'skills.sh',
        sourceRepo: 'xixu-me/skills',
        repoUrl: 'https://github.com/xixu-me/skills',
        installs: 221336,
        installed: false,
        installable: true,
        installCommand: 'npx skills add xixu-me/skills --skill github-actions-docs',
      },
    ],
  },
};

const githubSearchResponse = {
  ...skillCatalogResponse,
  catalog: {
    ...skillCatalogResponse.catalog,
    query: 'github',
    counts: {
      total: 1,
      returned: 1,
      installed: 0,
      available: 1,
      installable: 1,
    },
    skills: [skillCatalogResponse.catalog.skills[2]],
  },
};

function buildSkillResponseWithItems(count: number) {
  return {
    ...skillCatalogResponse,
    catalog: {
      ...skillCatalogResponse.catalog,
      counts: {
        total: count,
        returned: count,
        installed: 0,
        available: count,
        installable: count,
      },
      skills: Array.from({ length: count }, (_, index) => ({
        id: `owner/repo/skill-${String(index).padStart(2, '0')}`,
        skillId: `skill-${String(index).padStart(2, '0')}`,
        name: `skill-${String(index).padStart(2, '0')}`,
        source: 'skills.sh',
        sourceRepo: 'owner/repo',
        repoUrl: 'https://github.com/owner/repo',
        installs: index,
        installed: false,
        installable: true,
        installCommand: `npx skills add owner/repo --skill skill-${String(index).padStart(2, '0')}`,
      })),
    },
  };
}

async function flushSkillMarketPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('SkillMarketContent', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/skill-market/search?limit=60&q=agent') return skillCatalogResponse;
      if (url === '/api/skill-market/search?limit=60&q=github') return githubSearchResponse;
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('renders a Discover-family skill market without the Settings manager shell', async () => {
    await act(async () => {
      root.render(<SkillMarketContent />);
      await flushSkillMarketPromises();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/skill-market/search?limit=60&q=agent',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(host.textContent).toContain('Skill Market');
    expect(host.textContent).toContain('skills.sh index');
    expect(host.textContent).toContain('CLI install');
    expect(host.textContent).toContain('Public skill search');
    expect(host.textContent).toContain('agent-browser');
    expect(host.textContent).toContain('web-design-guidelines');
    expect(host.textContent).toContain('Installed');
    expect(host.textContent).not.toContain('Skill Search Paths');
    expect(host.textContent).not.toContain('+ Add Skill');

    const links = Array.from(host.querySelectorAll('a')).map((link) => link.getAttribute('href'));
    expect(links).toContain('/explore');
    expect(links).toContain('/agents?tab=skills');
    expect(links).not.toContain('/settings?tab=mcp');
    expect(links).toContain('https://github.com/vercel-labs/agent-browser');
  });

  it('searches skills and copies an explicit CLI install command', async () => {
    await act(async () => {
      root.render(<SkillMarketContent />);
      await flushSkillMarketPromises();
    });

    const input = host.querySelector('[data-skill-market-search]') as HTMLInputElement;
    const submit = host.querySelector('[data-skill-market-search-submit]') as HTMLButtonElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    await act(async () => {
      setter?.call(input, 'github');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      submit.click();
      await flushSkillMarketPromises();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/skill-market/search?limit=60&q=github',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(host.textContent).toContain('Search: github');
    expect(host.textContent).toContain('github-actions-docs');
    expect(host.textContent).toContain('npx skills add xixu-me/skills --skill github-actions-docs');

    const copyButton = host.querySelector('[data-skill-market-copy="xixu-me/skills/github-actions-docs"]') as HTMLButtonElement;
    await act(async () => {
      copyButton.click();
      await flushSkillMarketPromises();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'npx skills add xixu-me/skills --skill github-actions-docs',
    );
    expect(host.textContent).toContain('Copied');
  });

  it('shows a retry action when the skill index load fails', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/skill-market/search?limit=60&q=agent') throw new Error('network offline');
      if (url === '/api/skill-market/search?limit=60&q=agent&refresh=1') return skillCatalogResponse;
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<SkillMarketContent />);
      await flushSkillMarketPromises();
    });

    expect(host.textContent).toContain('Could not load skill index: network offline');
    const retry = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Retry')) as HTMLButtonElement;
    expect(retry).toBeTruthy();

    await act(async () => {
      retry.click();
      await flushSkillMarketPromises();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/skill-market/search?limit=60&q=agent&refresh=1',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(host.textContent).toContain('agent-browser');
  });

  it('filters installed skills without making extra catalog requests', async () => {
    await act(async () => {
      root.render(<SkillMarketContent />);
      await flushSkillMarketPromises();
    });
    const callsBeforeFilter = mocks.apiFetch.mock.calls.length;
    const installedFilter = host.querySelector('[data-skill-market-filter="installed"]') as HTMLButtonElement;

    await act(async () => {
      installedFilter.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('web-design-guidelines');
    expect(host.textContent).not.toContain('agent-browser');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(callsBeforeFilter);
  });

  it('renders large result sets progressively', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/skill-market/search?limit=60&q=agent') return buildSkillResponseWithItems(30);
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<SkillMarketContent />);
      await flushSkillMarketPromises();
    });

    expect(host.textContent).toContain('skill-23');
    expect(host.textContent).not.toContain('skill-24');
    const showMore = host.querySelector('[data-skill-market-show-more]') as HTMLButtonElement;
    expect(showMore).toBeTruthy();

    await act(async () => {
      showMore.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('skill-24');
  });
});
