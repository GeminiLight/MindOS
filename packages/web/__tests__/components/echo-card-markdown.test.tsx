// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EchoCardBody, EchoCardDetailFields } from '@/components/echo/EchoSemanticCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Echo card markdown rendering', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('renders markdown in the card body instead of showing raw syntax', async () => {
    await act(async () => {
      root.render(
        <EchoCardBody>
          {'不是纯文本：**重点** 和 `lint`\n\n- 第一条\n- 第二条'}
        </EchoCardBody>,
      );
    });

    const body = host.querySelector('[data-testid="echo-card-markdown"]');
    expect(body).not.toBeNull();
    expect(body?.querySelector('strong')?.textContent).toBe('重点');
    expect(body?.querySelector('code')?.textContent).toBe('lint');
    expect(body?.querySelectorAll('ul li')).toHaveLength(2);
    expect(body?.textContent).not.toContain('**重点**');
    expect(body?.textContent).not.toContain('`lint`');
  });

  it('renders markdown in source details as supporting evidence', async () => {
    await act(async () => {
      root.render(
        <EchoCardDetailFields
          sourceLabel="来源"
          source={'assistant: **runtime 健康检查不是启动项**，可以跑 `subagent doctor`。'}
        />,
      );
    });

    const detail = host.querySelector('[data-testid="echo-card-detail-markdown"]');
    expect(detail).not.toBeNull();
    expect(detail?.querySelector('strong')?.textContent).toBe('runtime 健康检查不是启动项');
    expect(detail?.querySelector('code')?.textContent).toBe('subagent doctor');
    expect(detail?.textContent).not.toContain('**runtime 健康检查不是启动项**');
    expect(detail?.textContent).not.toContain('`subagent doctor`');
  });
});
