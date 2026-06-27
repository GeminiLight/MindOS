// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RuntimeIconSwitcher from '@/components/ask/RuntimeIconSwitcher';
import type { AgentRuntimeReadinessProjection } from '@/lib/types';

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

const RAW_CODEX_OPTIONAL_DEPENDENCY_STACK = [
  'file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102',
  'throw new Error(`^ Error: Missing optional dependency @openai/codex-darwin-x64. Reinstall Codex: npm install -g @openai/codex@latest',
  'at findCodexExecutable (file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102:9)',
  'at ModuleJob.run (node:internal/modules/esm/module_job:274:25)',
  'at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)',
  'Node.js v22.16.0',
].join('\n');

function readinessProjection(
  runtimeId: string,
  runtimeName: string,
  runtimeKind: AgentRuntimeReadinessProjection['runtimeKind'],
  overrides: Partial<AgentRuntimeReadinessProjection> = {},
): AgentRuntimeReadinessProjection {
  return {
    schemaVersion: 1,
    runtimeId,
    runtimeName,
    runtimeKind,
    runtimeStatus: 'available',
    overallStatus: 'limited',
    summary: `${runtimeName} has partial runtime readiness.`,
    recommendations: [],
    useCases: [],
    gaps: [],
    ...overrides,
  };
}

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

  it('shows Claude Code CLI fallback as an available compatibility bridge', async () => {
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
              status: 'available',
              runtimeBridge: {
                kind: 'claude-cli',
                label: 'CLI fallback active',
                fallback: true,
                reason: 'SDK missing',
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

    expect(document.body.textContent).toContain('CLI fallback active. SDK missing');
    expect(document.body.textContent).not.toContain('Use local Claude Code.');
    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('CLI fallback active. SDK missing')) as HTMLButtonElement;
    expect(claudeButton.disabled).toBe(false);

    await act(async () => {
      claudeButton.click();
    });
    expect(onSelect).toHaveBeenCalledWith({
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
      status: 'available',
      runtimeBridge: {
        kind: 'claude-cli',
        label: 'CLI fallback active',
        fallback: true,
        reason: 'SDK missing',
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces runtime readiness gaps without disabling an available native runtime', async () => {
    const onSelect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={onSelect}
          nativeRuntimes={[{ id: 'codex', name: 'Codex', kind: 'codex', status: 'available' }]}
          loading={false}
          runtimeReadinessByRuntimeId={{
            codex: readinessProjection('codex', 'Codex', 'codex', {
              overallStatus: 'limited',
              gaps: [
                {
                  id: 'durable-approval-queue',
                  category: 'mindos-product',
                  severity: 'warning',
                  summary: 'MindOS still keeps Codex approval prompts interactive-only.',
                  useCases: ['permission-governance'],
                },
              ],
            }),
          }}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Limited');
    expect(document.body.textContent).toContain('MindOS: MindOS still keeps Codex approval prompts interactive-only.');
    const codexButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Use local Codex.')) as HTMLButtonElement;
    expect(codexButton.disabled).toBe(false);

    await act(async () => {
      codexButton.click();
    });
    expect(onSelect).toHaveBeenCalledWith({ id: 'codex', name: 'Codex', kind: 'codex', status: 'available' });

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps native detection status as the hard disable reason even when readiness is blocked', async () => {
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
              },
            },
          ]}
          loading={false}
          runtimeReadinessByRuntimeId={{
            codex: readinessProjection('codex', 'Codex', 'codex', {
              overallStatus: 'blocked',
              gaps: [
                {
                  id: 'runtime-authenticated',
                  category: 'user-setup',
                  severity: 'blocking',
                  summary: 'Codex must be authenticated before readiness can be trusted.',
                  useCases: ['interactive-turn'],
                },
              ],
            }),
          }}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Signed out');
    expect(document.body.textContent).toContain('Blocked');
    expect(document.body.textContent).toContain('Setup: Codex must be authenticated before readiness can be trusted.');
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

  it('shows MindOS product readiness gaps on the default runtime option', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={null}
          onSelect={vi.fn()}
          nativeRuntimes={[]}
          runtimeReadinessByRuntimeId={{
            mindos: readinessProjection('mindos', 'MindOS', 'mindos', {
              overallStatus: 'limited',
              gaps: [
                {
                  id: 'scheduler',
                  category: 'mindos-product',
                  severity: 'warning',
                  summary: 'MindOS needs scheduler and wake-resume support before 24/7 automation is ready.',
                  useCases: ['unattended-automation'],
                },
              ],
            }),
          }}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Use MindOS');
    expect(document.body.textContent).toContain('Limited');
    expect(document.body.textContent).toContain('MindOS: MindOS needs scheduler and wake-resume support before 24/7 automation is ready.');
    const mindosSwitchButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Use MindOS'));
    expect(mindosSwitchButton).toBeUndefined();

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
    expect(codexButton.children[1]?.textContent).toBe('Codex');
    expect(codexButton.children[2]?.textContent).toBe('Sign in');
    await act(async () => {
      codexButton.click();
    });
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('compacts Codex optional dependency stacks into an actionable disabled option', async () => {
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
              status: 'error',
              availability: {
                checkedAt: '2026-06-09T00:00:00.000Z',
                sources: ['native-health'],
                reason: RAW_CODEX_OPTIONAL_DEPENDENCY_STACK,
                diagnosticHints: [
                  RAW_CODEX_OPTIONAL_DEPENDENCY_STACK,
                  'MindOS detected Codex at /opt/homebrew/bin/codex.',
                  'Run "codex app-server --help" from the MindOS server environment.',
                ],
              },
            },
            { id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' },
          ]}
          loading={false}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('Codex is installed but incomplete.');
    expect(document.body.textContent).toContain('npm install -g @openai/codex@latest');
    expect(document.body.textContent).toContain('MindOS detected Codex at /opt/homebrew/bin/codex.');
    expect(document.body.textContent).not.toContain('file:///opt/homebrew');
    expect(document.body.textContent).not.toContain('throw new Error');
    expect(document.body.textContent).not.toContain('ModuleJob.run');
    expect(document.body.textContent).not.toContain('node:internal');
    expect(document.body.textContent).not.toContain('Node.js v22.16.0');

    const codexButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Codex is installed but incomplete.')) as HTMLButtonElement;
    expect(document.body.textContent).toContain('Use MindOS');
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
    const configLink = document.body.querySelector('a[aria-label="Configure agents"]') as HTMLAnchorElement;
    expect(configLink).toBeTruthy();
    expect(configLink.getAttribute('href')).toBe('/agents?tab=agent');
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
      .find((button) => button.textContent?.includes('Codex')) as HTMLButtonElement | undefined;
    const mindosButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Use MindOS')) as HTMLButtonElement;
    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Claude Code')) as HTMLButtonElement;
    expect(codexButton).toBeUndefined();
    expect(mindosButton.disabled).toBe(false);
    expect(claudeButton.disabled).toBe(true);
    await act(async () => {
      mindosButton.click();
      claudeButton.click();
    });
    expect(onSelect).toHaveBeenCalledWith(null);

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
      .find((button) => button.textContent?.includes('Use MindOS')) as HTMLButtonElement | undefined;
    const codexButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Codex')) as HTMLButtonElement;
    const claudeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Claude Code')) as HTMLButtonElement;

    expect(mindosButton).toBeUndefined();
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

  it('does not show stale cached native runtime errors while that runtime is checking', async () => {
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
              status: 'error',
              availability: {
                checkedAt: '2026-06-09T00:00:00.000Z',
                sources: ['native-health'],
                reason: RAW_CODEX_OPTIONAL_DEPENDENCY_STACK,
              },
            },
            { id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' },
          ]}
          errorByKind={{ codex: RAW_CODEX_OPTIONAL_DEPENDENCY_STACK }}
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
    expect(codexButton.textContent).toContain('Checking local Codex...');
    expect(codexButton.textContent).not.toContain('file:///opt/homebrew');
    expect(codexButton.textContent).not.toContain('Missing optional dependency');
    expect(claudeButton.disabled).toBe(false);

    await act(async () => {
      claudeButton.click();
    });
    expect(onSelect).toHaveBeenCalledWith({ id: 'claude', name: 'Claude Code', kind: 'claude', status: 'available' });

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

  it('uses the ACP descriptor for the current runtime without repeating it as a switch target', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeIconSwitcher
          selectedRuntime={{ id: 'opencode', name: 'OpenCode', kind: 'acp' }}
          onSelect={vi.fn()}
          nativeRuntimes={[]}
          acpRuntimes={[
            {
              id: 'opencode',
              name: 'OpenCode',
              kind: 'acp',
              status: 'available',
              description: 'ACP coding agent.',
              binaryPath: '/usr/local/bin/opencode',
            },
            {
              id: 'aider',
              name: 'Aider',
              kind: 'acp',
              status: 'available',
              description: 'ACP-compatible pair programming agent.',
              binaryPath: '/usr/local/bin/aider',
            },
          ]}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    expect(trigger.title).toBe('OpenCode');
    expect(trigger.querySelector('img[src="/agent-icons/opencode.svg"]')).toBeTruthy();

    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('OpenCode');
    expect(document.body.textContent).toContain('ACP coding agent.');
    expect(Array.from(document.body.querySelectorAll('button'))
      .filter((button) => button.textContent?.includes('OpenCode'))).toHaveLength(0);

    expect(Array.from(document.body.querySelectorAll('button'))
      .some((button) => button.textContent?.includes('More agents'))).toBe(false);
    expect(document.body.textContent).toContain('Aider');
    expect(document.body.textContent).toContain('Collapse');
    expect(Array.from(document.body.querySelectorAll('button'))
      .filter((button) => button.textContent?.includes('OpenCode'))).toHaveLength(0);

    await act(async () => {
      root.unmount();
    });
  });

  it('expands More agents to select available ACP runtimes', async () => {
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
          acpRuntimes={[
            {
              id: 'opencode',
              name: 'OpenCode',
              kind: 'acp',
              status: 'available',
              description: 'ACP coding agent.',
              binaryPath: '/usr/local/bin/opencode',
            },
            {
              id: 'cursor-agent',
              name: 'Cursor Agent',
              kind: 'acp',
              status: 'signed-out',
              availability: {
                checkedAt: '2026-06-09T00:00:00.000Z',
                sources: ['acp-detect'],
                reason: 'Cursor Agent needs sign-in.',
              },
            },
          ]}
        />,
      );
    });

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });

    expect(document.body.textContent).toContain('More agents');
    expect(document.body.textContent).not.toContain('OpenCode');

    const moreButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('More agents')) as HTMLButtonElement;
    await act(async () => {
      moreButton.click();
    });

    expect(document.body.textContent).not.toContain('More agents');
    expect(document.body.textContent).toContain('Collapse');

    const openCodeButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('OpenCode')) as HTMLButtonElement;
    const cursorButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Cursor Agent')) as HTMLButtonElement;

    expect(openCodeButton.disabled).toBe(false);
    expect(openCodeButton.children[0]?.querySelector('img[src="/agent-icons/opencode.svg"]')).toBeTruthy();
    expect(cursorButton.disabled).toBe(true);
    expect(cursorButton.textContent).toContain('Sign in');
    expect(cursorButton.children[0]?.querySelector('img[src="/agent-icons/cursor.svg"]')).toBeTruthy();

    await act(async () => {
      cursorButton.click();
      openCodeButton.click();
    });

    expect(onSelect).toHaveBeenCalledWith({
      id: 'opencode',
      name: 'OpenCode',
      kind: 'acp',
      binaryPath: '/usr/local/bin/opencode',
      status: 'available',
    });

    await act(async () => {
      root.unmount();
    });
  });
});
