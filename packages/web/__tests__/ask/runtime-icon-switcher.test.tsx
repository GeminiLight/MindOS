// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RuntimeIconSwitcher from '@/components/ask/RuntimeIconSwitcher';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      panels: {
        agents: {
          acpDefaultAgent: 'MindOS',
          acpSelectAgent: 'Select runtime',
          acpChangeAgent: 'Change runtime',
        },
      },
    },
  }),
}));

describe('RuntimeIconSwitcher', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('shows the active native runtime binding without session management actions', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={{ id: 'codex', name: 'Codex', kind: 'codex' }}
          onSelect={onSelect}
          runtimeSessionBinding={{
            kind: 'codex-thread',
            runtime: 'codex',
            runtimeId: 'codex',
            externalSessionId: 'thread_1234567890abcdef',
            cwd: '/tmp/mind',
            status: 'active',
            updatedAt: 1,
          }}
          nativeRuntimes={[{ id: 'codex', name: 'Codex', kind: 'codex' }]}
          loading={false}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Thread thread_1...abcdef');
    expect(document.body.textContent).toContain('/tmp/mind');
    expect(document.body.textContent).not.toContain('Fresh thread');
    expect(document.body.textContent).not.toContain('Fresh session');
    expect(document.body.textContent).not.toContain('Unlink');
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps Claude Code runtime menu focused on runtime selection only', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={{ id: 'claude', name: 'Claude Code', kind: 'claude' }}
          onSelect={onSelect}
          runtimeSessionBinding={{
            kind: 'claude-session',
            runtime: 'claude',
            runtimeId: 'claude',
            externalSessionId: 'session_1234567890abcdef',
            cwd: '/tmp/mind',
            status: 'active',
            updatedAt: 1,
          }}
          nativeRuntimes={[{ id: 'claude', name: 'Claude Code', kind: 'claude' }]}
          loading={false}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Session session_...abcdef');
    expect(document.body.textContent).not.toContain('Fresh session');
    expect(document.body.textContent).not.toContain('Unlink');
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('shows unavailable native runtimes as disabled options with their status reason without listing ACP agents', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={onSelect}
          nativeRuntimes={[
            {
              id: 'codex',
              name: 'Codex',
              kind: 'codex',
              status: 'signed-out',
              availability: {
                checkedAt: '2026-06-09T00:00:00.000Z',
                sources: ['native-health'],
                reason: 'Run codex login first.',
                diagnosticHints: [
                  'MindOS detected Codex at /usr/local/bin/codex.',
                  'Run "codex login status" from the same environment that starts MindOS.',
                ],
              },
            },
          ]}
          loading={false}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Signed out');
    expect(document.body.textContent).toContain('Run codex login first.');
    expect(document.body.textContent).toContain('MindOS detected Codex at /usr/local/bin/codex.');
    expect(document.body.textContent).toContain('Run "codex login status" from the same environment that starts MindOS.');
    expect(document.body.textContent).not.toContain('OpenCode');
    expect(document.body.textContent).not.toContain('Config file is invalid.');

    const codexButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Run codex login first.')) as HTMLButtonElement;
    expect(codexButton.disabled).toBe(true);
    await act(async () => {
      codexButton.click();
    });
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces runtime detection errors as the disabled option reason', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={onSelect}
          nativeRuntimes={[]}
          errorByKind={{ claude: 'claude runtime detection timed out after 30000ms.' }}
          loading={false}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Detection failed. claude runtime detection timed out after 30000ms.');
    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Detection failed. claude runtime detection timed out')) as HTMLButtonElement;
    expect(claudeButton.disabled).toBe(true);
    await act(async () => {
      claudeButton.click();
    });
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('disables cached available native runtimes when revalidation reports an error', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={onSelect}
          nativeRuntimes={[{ id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' }]}
          errorByKind={{ claude: 'Detection failed' }}
          loadingByKind={{ claude: false }}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Detection failed')) as HTMLButtonElement;
    expect(claudeButton.disabled).toBe(true);
    await act(async () => {
      claudeButton.click();
    });
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('lets the user retry local runtime detection from the runtime menu', async () => {
    const onRefreshNativeRuntimes = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={vi.fn()}
          nativeRuntimes={[]}
          errorByKind={{ codex: 'Detection failed' }}
          onRefreshNativeRuntimes={onRefreshNativeRuntimes}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    const refreshButton = document.body.querySelector('button[aria-label="Refresh local runtime status"]') as HTMLButtonElement;
    expect(refreshButton).toBeTruthy();
    await act(async () => {
      refreshButton.click();
    });
    expect(onRefreshNativeRuntimes).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the runtime logo visible while detection is loading', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={{ id: 'claude', name: 'Claude Code', kind: 'claude' }}
          onSelect={vi.fn()}
          nativeRuntimes={[{ id: 'claude', name: 'Claude Code', kind: 'claude' }]}
          loading
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    expect(trigger.title).toBe('Checking selected local agent');
    expect(trigger.querySelector('img[src="/agent-icons/claude.svg"]')).toBeTruthy();
    expect(trigger.querySelector('.animate-spin')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it('shows Codex and Claude Code as disabled options while detection is loading', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={{ id: 'codex', name: 'Codex', kind: 'codex' }}
          onSelect={onSelect}
          nativeRuntimes={[]}
          loading
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Codex');
    expect(document.body.textContent).toContain('Claude Code');
    expect(document.body.textContent).toContain('Checking...');
    expect(document.body.textContent).not.toContain('Codex and Claude Code cold starts can take up to 20 seconds.');

    const codexButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Codex')) as HTMLButtonElement;
    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Claude Code')) as HTMLButtonElement;
    expect(codexButton.disabled).toBe(true);
    expect(claudeButton.disabled).toBe(true);
    await act(async () => {
      codexButton.click();
      claudeButton.click();
    });
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps MindOS enabled and native runtimes disabled during background detection', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={onSelect}
          nativeRuntimes={[
            { id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' },
          ]}
          loading
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    expect(trigger.querySelector('img[src="/logo-square.svg"]')).toBeTruthy();
    await act(async () => {
      trigger.click();
    });

    const mindosButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Use MindOS')) as HTMLButtonElement;
    const codexButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Codex')) as HTMLButtonElement;
    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Claude Code')) as HTMLButtonElement;

    expect(mindosButton.disabled).toBe(false);
    expect(codexButton.disabled).toBe(true);
    expect(codexButton.textContent).toContain('Checking...');
    expect(codexButton.querySelector('img[src="/agent-icons/openai.svg"]')).toBeTruthy();
    expect(claudeButton.disabled).toBe(true);
    expect(claudeButton.textContent).toContain('Checking...');
    expect(claudeButton.querySelector('img[src="/agent-icons/claude.svg"]')).toBeTruthy();

    await act(async () => {
      claudeButton.click();
    });
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('shows cached unavailable native runtimes as checking while detection is loading', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={onSelect}
          nativeRuntimes={[
            {
              id: 'claude',
              name: 'Claude Code',
              kind: 'claude',
              status: 'missing',
              availability: {
                checkedAt: '2026-06-09T00:00:00.000Z',
                sources: ['native-health'],
                reason: 'Claude Code executable was not detected.',
              },
            },
          ]}
          loading
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Claude Code')) as HTMLButtonElement;
    expect(claudeButton.disabled).toBe(true);
    expect(claudeButton.textContent).toContain('Checking...');
    expect(claudeButton.textContent).not.toContain('Missing');

    await act(async () => {
      claudeButton.click();
    });
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps one native runtime enabled when only its sibling is still checking', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={onSelect}
          nativeRuntimes={[
            { id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' },
          ]}
          loadingByKind={{ codex: true, claude: false }}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    const codexButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Codex')) as HTMLButtonElement;
    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Claude Code')) as HTMLButtonElement;
    expect(codexButton.disabled).toBe(true);
    expect(codexButton.textContent).toContain('Checking...');
    expect(claudeButton.disabled).toBe(false);
    expect(claudeButton.textContent).not.toContain('Checking...');

    await act(async () => {
      claudeButton.click();
    });
    expect(onSelect).toHaveBeenCalledWith({ id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' });

    await act(async () => {
      root.unmount();
    });
  });

  it('does not spin the trigger while only an unselected runtime is checking', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={{ id: 'claude', name: 'Claude Code', kind: 'claude' }}
          onSelect={vi.fn()}
          nativeRuntimes={[
            { id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' },
          ]}
          loadingByKind={{ codex: true, claude: false }}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    expect(trigger.title).toBe('Claude Code');
    expect(trigger.querySelector('img[src="/agent-icons/claude.svg"]')).toBeTruthy();
    expect(trigger.querySelector('.animate-spin')).toBeFalsy();

    await act(async () => {
      trigger.click();
    });

    const codexButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Codex')) as HTMLButtonElement;
    expect(codexButton.disabled).toBe(true);
    expect(codexButton.textContent).toContain('Checking...');

    await act(async () => {
      root.unmount();
    });
  });
});
