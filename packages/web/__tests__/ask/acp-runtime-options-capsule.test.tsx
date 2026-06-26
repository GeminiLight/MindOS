// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AcpRuntimeOptionsCapsule from '@/components/ask/AcpRuntimeOptionsCapsule';
import type { RuntimeSessionProjection } from '@/lib/types';

const baseProjection: RuntimeSessionProjection = {
  schemaVersion: 1,
  runtimeId: 'fake-acp',
  runtimeName: 'Fake ACP',
  runtimeKind: 'acp',
  runtimeStatus: 'available',
  sessionOwner: 'mindos',
  permissionOwner: 'mindos',
  status: 'active',
  source: 'acp-session-snapshot',
  session: {
    kind: 'acp-session',
    sessionId: 'ses-1',
    state: 'active',
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  controls: {
    model: {
      status: 'available',
      owner: 'external',
      source: 'session-observed',
      configId: 'model',
      currentValue: 'cheap',
      options: [
        { id: 'cheap', label: 'Cheap' },
        { id: 'smart', label: 'Smart' },
      ],
      summary: 'Model control',
    },
    mode: {
      status: 'available',
      owner: 'external',
      source: 'session-observed',
      configId: 'mode',
      currentValue: 'default',
      options: [
        { id: 'default', label: 'Default' },
        { id: 'code', label: 'Code' },
      ],
      summary: 'Mode config control',
    },
    thoughtLevel: {
      status: 'available',
      owner: 'external',
      source: 'session-observed',
      configId: 'reasoning_effort',
      currentValue: 'low',
      options: [
        { id: 'low', label: 'Low' },
        { id: 'high', label: 'High' },
      ],
      summary: 'Thought control',
    },
  },
  slashCommands: {
    status: 'available',
    source: 'session-observed',
    commands: [],
    summary: 'Commands',
  },
  toolEvents: {
    status: 'available',
    calls: [],
    summary: { total: 0, pending: 0, inProgress: 0, completed: 0, failed: 0 },
  },
  permissionEvents: {
    status: 'available',
    events: [],
    pending: [],
    summary: 'Permissions',
  },
  reasons: [],
};

function renderCapsule(
  projection: RuntimeSessionProjection,
  onChange = vi.fn(),
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <AcpRuntimeOptionsCapsule
        projection={projection}
        value={{}}
        onChange={onChange}
      />,
    );
  });

  return {
    host,
    onChange,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickButtonContaining(text: string) {
  const button = Array.from(document.body.querySelectorAll('button'))
    .find((item) => item.textContent?.includes(text)) as HTMLButtonElement | undefined;
  expect(button).toBeTruthy();
  act(() => {
    button!.click();
  });
}

describe('AcpRuntimeOptionsCapsule', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('writes config-backed mode selection as configValues instead of modeId', () => {
    const view = renderCapsule(baseProjection);

    clickButtonContaining('Default');
    clickButtonContaining('Code');

    expect(view.onChange).toHaveBeenLastCalledWith({
      configValues: { mode: 'code' },
    });

    view.cleanup();
  });

  it('writes modeId when the mode control comes from ACP modes without a config id', () => {
    const { configId: _configId, ...modeWithoutConfigId } = baseProjection.controls.mode;
    const projection: RuntimeSessionProjection = {
      ...baseProjection,
      controls: {
        ...baseProjection.controls,
        mode: modeWithoutConfigId,
      },
    };
    const view = renderCapsule(projection);

    clickButtonContaining('Default');
    clickButtonContaining('Code');

    expect(view.onChange).toHaveBeenLastCalledWith({ modeId: 'code' });

    view.cleanup();
  });
});
