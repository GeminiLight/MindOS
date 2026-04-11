// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AgentsContentChannelDetail from '@/components/agents/AgentsContentChannelDetail';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en',
    t: {
      panels: {
        im: {
          emptyDesc: 'Connect messaging platforms to let MindOS send messages on your behalf.',
          backToChannels: 'Back to Channels',
          statusConnected: 'Connected',
          notConfigured: 'Set up',
          fetchError: 'Failed to load channel status.',
          thisIsNotChat: 'This is a delivery channel, not a chat inbox.',
          retry: 'Retry',
          howItWorks: 'How it works',
          currentMode: 'Current mode',
          notificationsOnly: 'Notifications only',
          twoWayConversation: 'Two-way conversation',
          conversationTitle: 'Conversation',
          conversationEnable: 'Allow messages from Feishu',
          conversationWaiting: 'Waiting for verification',
          conversationReady: 'Ready for replies',
          conversationDisabled: 'Disabled',
          conversationNeedsPublicUrl: 'Public URL required',
          conversationNeedsEncryptKey: 'Encrypt Key required',
          conversationHint: 'Users can DM the bot, and group messages only trigger when the bot is mentioned.',
          conversationConfigHint: 'Turn this on after you have a reachable public URL and your Feishu Encrypt Key ready.',
          conversationWebhookUrl: 'Webhook URL',
          conversationCopyUrl: 'Copy URL',
          conversationStatus: 'Webhook status',
          conversationReachability: 'Reachability',
          conversationReachabilityHint: 'Feishu must be able to reach this URL from the public internet.',
          conversationOpenPlatform: 'Open Feishu console',
          conversationPublicBaseUrl: 'Public base URL',
          conversationEncryptKey: 'Encrypt Key',
          conversationVerificationToken: 'Verification Token',
          conversationVerificationTokenHint: 'Used for Feishu webhook challenge verification. Leave blank to keep the saved value.',
          conversationSecretPlaceholder: 'Leave blank to keep saved value',
          conversationGroupMentions: 'Only reply when mentioned in groups',
          conversationSaved: 'Conversation settings saved',
          conversationSave: 'Save conversation settings',
          workInMindosHint: 'Use Ask in MindOS to work with the agent.',
          useCasesTitle: 'What you can receive',
          statusSummaryTitle: 'Status summary',
          lastActivity: 'Last activity',
          lastRecipient: 'Last recipient',
          noActivityYet: 'No messages sent yet',
          noActivityHint: 'Send a sample message to verify this channel is working.',
          recentActivity: 'Recent activity',
          sendSample: 'Send sample notification',
          sampleHint: 'This sends a real outbound message through the selected channel.',
          settingsTitle: 'Settings',
          settingsHint: 'Maintain credentials and channel settings here.',
          latestSuccess: 'Latest success',
          latestFailure: 'Latest failure',
          noRecentActivity: 'No recent activity',
          notAvailable: 'Not available',
          activityTypeTest: 'Sample message',
          activityTypeAgent: 'Agent update',
          activityTypeManual: 'Manual send',
          disconnectHint: 'Remove credentials and disconnect this platform.',
          disconnect: 'Disconnect',
          confirmDisconnect: 'Confirm?',
          editCredentials: 'Update credentials',
          editCredentialsHint: 'Need to rotate tokens or fix a broken connection?',
          guideLink: 'Open setup guide',
          recipientHint: 'Use the platform-specific recipient ID.',
          recipientPlaceholder: 'Recipient ID',
          messagePlaceholder: 'Hello from MindOS',
          savedValuesHint: 'Saved values stay hidden.',
          required: 'required',
          saving: 'Saving...',
          saved: 'Saved',
          saveConfig: 'Save',
          setupGuide: 'Setup Guide',
          tabConfigure: 'Configure',
          hideSecret: 'Hide',
          showSecret: 'Show',
          sentOk: 'Sent',
        },
      },
    },
  }),
}));

import { clearChannelCache } from '@/components/agents/channel-detail/cache';

describe('AgentsContentChannelDetail redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChannelCache();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('renders a connected Feishu channel with status bar, conversation, and activity', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/im/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            platforms: [{ platform: 'feishu', connected: true, botName: 'MindOS Bot', capabilities: ['text', 'markdown'], webhook: { state: 'ready', webhookUrl: 'https://mindos.example.com/api/im/webhook/feishu', publicBaseUrl: 'https://mindos.example.com', transport: 'webhook' } }],
          }),
        });
      }
      if (url.includes('/api/im/activity')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            activities: [{
              id: 'a1', platform: 'feishu', type: 'test', status: 'success',
              recipient: 'ou_123456', messageSummary: 'Hello from MindOS',
              timestamp: '2026-04-10T10:00:00.000Z',
            }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => { root.render(<AgentsContentChannelDetail platformId="feishu" />); });
    await act(async () => { await Promise.resolve(); });

    // Header
    expect(host.textContent).toContain('Feishu');
    expect(host.textContent).toContain('Connected');
    expect(host.textContent).toContain('MindOS Bot');

    // Status bar
    expect(host.textContent).toContain('Two-way conversation');

    // Conversation section
    expect(host.textContent).toContain('Conversation');
    expect(host.textContent).toContain('Allow messages from Feishu');

    // Activity
    expect(host.textContent).toContain('Recent activity');
    expect(host.textContent).toContain('Hello from MindOS');

    // Test send + Settings (collapsed)
    expect(host.textContent).toContain('Send sample notification');
    expect(host.textContent).toContain('Settings');

    await act(async () => { root.unmount(); });
  });

  it('renders long connection guidance without webhook URL fields', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/im/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            platforms: [{
              platform: 'feishu', connected: true, botName: 'MindOS Bot',
              capabilities: ['text', 'markdown'],
              webhook: { state: 'pending', lastError: 'Start the Feishu long connection client.', transport: 'long_connection' },
            }],
          }),
        });
      }
      if (url.includes('/api/im/activity')) {
        return Promise.resolve({ ok: true, json: async () => ({ activities: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => { root.render(<AgentsContentChannelDetail platformId="feishu" />); });
    await act(async () => { await Promise.resolve(); });

    expect(host.textContent).toContain('Waiting for verification');
    expect(host.textContent).toContain('Start the Feishu long connection client.');

    await act(async () => { root.unmount(); });
  });

  it('renders an unconfigured channel as setup flow with guide and form', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/im/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ platforms: [] }) });
      }
      if (url.includes('/api/im/activity')) {
        return Promise.resolve({ ok: true, json: async () => ({ activities: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => { root.render(<AgentsContentChannelDetail platformId="telegram" />); });
    await act(async () => { await Promise.resolve(); });

    // Setup flow: has guide, has form, no activity/settings
    expect(host.textContent).toContain('Setup Guide');
    expect(host.textContent).toContain('Bot Token');
    expect(host.textContent).toContain('Save');
    expect(host.textContent).not.toContain('Recent activity');
    expect(host.textContent).not.toContain('Settings');

    await act(async () => { root.unmount(); });
  });

  it('renders a connected non-Feishu channel without conversation section', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/im/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            platforms: [{ platform: 'telegram', connected: true, botName: '@testbot', capabilities: ['text'] }],
          }),
        });
      }
      if (url.includes('/api/im/activity')) {
        return Promise.resolve({ ok: true, json: async () => ({ activities: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => { root.render(<AgentsContentChannelDetail platformId="telegram" />); });
    await act(async () => { await Promise.resolve(); });

    expect(host.textContent).toContain('Telegram');
    expect(host.textContent).toContain('Connected');
    expect(host.textContent).toContain('@testbot');
    expect(host.textContent).toContain('Recent activity');
    expect(host.textContent).not.toContain('Conversation');

    await act(async () => { root.unmount(); });
  });
});
