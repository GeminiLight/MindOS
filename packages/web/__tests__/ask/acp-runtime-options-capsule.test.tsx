// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AcpRuntimeOptionsCapsule, {
  getPersistedAcpRuntimeOptions,
  persistAcpRuntimeOptions,
} from '@/components/ask/AcpRuntimeOptionsCapsule';
import type { AcpRuntimeOptions, RuntimeSessionProjection } from '@/lib/types';

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
  projection: RuntimeSessionProjection | null,
  onChange = vi.fn(),
  value: AcpRuntimeOptions = {},
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <AcpRuntimeOptionsCapsule
        projection={projection}
        runtime={{ kind: 'acp', id: 'fake-acp', name: 'Fake ACP' }}
        value={value}
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
    localStorage.clear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('writes model selection as ACP configValues', () => {
    const view = renderCapsule(baseProjection);

    clickButtonContaining('Cheap');
    clickButtonContaining('Smart');

    expect(view.onChange).toHaveBeenLastCalledWith({
      configValues: { model: 'smart' },
    });

    view.cleanup();
  });

  it('writes effort selection as ACP reasoning configValues', () => {
    const view = renderCapsule(baseProjection);

    clickButtonContaining('Low');
    expect(document.body.textContent).toContain('Effort');
    clickButtonContaining('High');

    expect(view.onChange).toHaveBeenLastCalledWith({
      configValues: { reasoning_effort: 'high' },
    });

    view.cleanup();
  });

  it('writes config-backed mode selection as configValues instead of modeId', () => {
    const view = renderCapsule(baseProjection);

    clickButtonContaining('Build');
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

    clickButtonContaining('Build');
    clickButtonContaining('Code');

    expect(view.onChange).toHaveBeenLastCalledWith({ modeId: 'code' });

    view.cleanup();
  });

  it('shows a default Build/Plan agent mode control before ACP projection is available', () => {
    const view = renderCapsule(null);

    expect(view.host.textContent).toContain('Default');
    expect(view.host.textContent).toContain('Medium');

    clickButtonContaining('Build');
    clickButtonContaining('Plan');

    expect(view.onChange).toHaveBeenLastCalledWith({ modeId: 'plan' });

    view.cleanup();
  });

  it('shows fallback ACP model and effort controls before projection is available', () => {
    const view = renderCapsule(null);

    clickButtonContaining('Medium');
    clickButtonContaining('High');
    expect(view.onChange).toHaveBeenLastCalledWith({
      configValues: { reasoning_effort: 'high' },
    });

    clickButtonContaining('Default');
    const input = document.body.querySelector('input[placeholder="model id"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'gpt-acp-test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const applyButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Apply')) as HTMLButtonElement;
    act(() => {
      applyButton.click();
    });

    expect(view.onChange).toHaveBeenLastCalledWith({
      configValues: { model: 'gpt-acp-test' },
    });

    view.cleanup();
  });

  it('persists compact ACP runtime options per runtime id', () => {
    persistAcpRuntimeOptions(' fake-acp ', {
      modeId: ' plan ',
      configValues: {
        model: ' smart ',
        empty: '',
        ' reasoning_effort ': ' high ',
      },
    });

    expect(getPersistedAcpRuntimeOptions('fake-acp')).toEqual({
      modeId: 'plan',
      configValues: {
        model: 'smart',
        reasoning_effort: 'high',
      },
    });

    expect(getPersistedAcpRuntimeOptions('other-acp')).toEqual({});

    persistAcpRuntimeOptions('fake-acp', {});
    expect(getPersistedAcpRuntimeOptions('fake-acp')).toEqual({});
  });

  it('uses persisted ACP values as the selected capsule labels', () => {
    const view = renderCapsule(baseProjection, vi.fn(), {
      modeId: 'plan',
      configValues: {
        model: 'smart',
        reasoning_effort: 'high',
      },
    });

    expect(view.host.textContent).toContain('Smart');
    expect(view.host.textContent).toContain('High');

    view.cleanup();
  });
});
