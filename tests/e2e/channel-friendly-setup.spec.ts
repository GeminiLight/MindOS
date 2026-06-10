import { expect, test, type Page } from '@playwright/test';

type PlatformFlow = {
  id: string;
  name: string;
  methodTitle: string;
  placeholders: string[];
  values: string[];
  hasQr: boolean;
  expectedCredentials: Record<string, string>;
};

const platforms: PlatformFlow[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    methodTitle: 'Create bot with BotFather',
    placeholders: ['123456789:AABBccDD-EeFfGgHh...'],
    values: ['123456789:ABCdefGHIjklMNOpqrSTUvwxYZ'],
    hasQr: true,
    expectedCredentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
  },
  {
    id: 'feishu',
    name: 'Feishu',
    methodTitle: 'Open Feishu developer console',
    placeholders: ['CLI_XXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXXXXXXXXX'],
    values: ['cli_test_app', 'secret_test_app'],
    hasQr: true,
    expectedCredentials: { app_id: 'cli_test_app', app_secret: 'secret_test_app' },
  },
  {
    id: 'discord',
    name: 'Discord',
    methodTitle: 'Create bot in Developer Portal',
    placeholders: ['MTIxNzM...'],
    values: ['MTIxNzMabcdefghijklmnopqrstuvwxyz'],
    hasQr: true,
    expectedCredentials: { bot_token: 'MTIxNzMabcdefghijklmnopqrstuvwxyz' },
  },
  {
    id: 'slack',
    name: 'Slack',
    methodTitle: 'Create Slack app',
    placeholders: ['xoxb-xxxx-xxxx-xxxx'],
    values: ['xoxb-1234567890-1234567890-abcdef'],
    hasQr: true,
    expectedCredentials: { bot_token: 'xoxb-1234567890-1234567890-abcdef' },
  },
  {
    id: 'wecom',
    name: 'WeCom',
    methodTitle: 'Paste the full group robot webhook',
    placeholders: ['https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'],
    values: ['https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=robot-key-123'],
    hasQr: false,
    expectedCredentials: { webhook_key: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=robot-key-123' },
  },
  {
    id: 'dingtalk',
    name: 'DingTalk',
    methodTitle: 'Create custom robot webhook',
    placeholders: ['https://oapi.dingtalk.com/robot/send?access_token=...'],
    values: ['https://oapi.dingtalk.com/robot/send?access_token=abc'],
    hasQr: false,
    expectedCredentials: { webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=abc' },
  },
  {
    id: 'wechat',
    name: 'WeChat',
    methodTitle: 'QR login in third-party bot console',
    placeholders: ['wx_xxxxxxxxxxxxxxxx'],
    values: ['wx_test_token'],
    hasQr: true,
    expectedCredentials: { bot_token: 'wx_test_token' },
  },
  {
    id: 'qq',
    name: 'QQ',
    methodTitle: 'Create QQ bot',
    placeholders: ['102xxxxxx', 'xxxxxxxxxxxxxxxxxxxxxxxx'],
    values: ['102123456', 'qq-secret-test'],
    hasQr: true,
    expectedCredentials: { app_id: '102123456', app_secret: 'qq-secret-test' },
  },
];

test.describe('Channel friendly setup user flow', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockChannelApis(page);
  });

  test('overview entry opens a platform setup detail', async ({ page }) => {
    await mockStatus(page, () => ({ platforms: [] }));

    await page.goto('/agents?tab=channels', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Platforms')).toBeVisible();
    await page.locator('main').getByRole('link', { name: /Telegram/ }).click();

    await expect(page).toHaveURL(/platform=telegram/);
    await expect(page.getByRole('heading', { name: 'Telegram', exact: true })).toBeVisible();
    await expect(page.getByText('Connection options')).toBeVisible();
  });

  for (const platform of platforms) {
    test(`first-time setup is clear and saveable for ${platform.name}`, async ({ page }) => {
      let savedPayload: any = null;
      let connected = false;
      await mockStatus(page, () => ({
        platforms: connected
          ? [{
            platform: platform.id,
            connected: true,
            botName: `${platform.name} Bot`,
            capabilities: ['text'],
          }]
          : [],
      }));
      await page.route('**/api/im/config**', async (route) => {
        if (route.request().method() === 'PUT') {
          savedPayload = JSON.parse(route.request().postData() ?? '{}');
          connected = true;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, platform: platform.id }),
        });
      });

      await gotoChannel(page, platform.id);

      await expect(page.getByRole('heading', { name: platform.name, exact: true })).toBeVisible();
      await expect(page.getByText('Connection options')).toBeVisible();
      await expect(page.getByText(platform.methodTitle)).toBeVisible();
      await expect(page.getByText('Manual setup')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

      if (platform.hasQr) {
        await expectQrReady(page);
      }

      const copyButton = page.getByRole('button', { name: 'Copy setup link' }).first();
      if (await copyButton.isVisible()) {
        await copyButton.click();
        await expect(page.getByRole('button', { name: 'Copy setup link' }).first()).toContainText('Copied');
      }

      for (const [index, placeholder] of platform.placeholders.entries()) {
        await page.getByPlaceholder(placeholder).fill(platform.values[index]);
      }

      await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Connected')).toBeVisible();
      await expect(page.locator('main').getByText(`${platform.name} Bot`).first()).toBeVisible();
      expect(savedPayload).toEqual({
        platform: platform.id,
        credentials: platform.expectedCredentials,
      });
    });
  }

  test('DingTalk signing secret is optional in setup', async ({ page }) => {
    let savedPayload: any = null;
    let connected = false;
    await mockStatus(page, () => ({
      platforms: connected
        ? [{ platform: 'dingtalk', connected: true, botName: 'DingTalk Bot', capabilities: ['text'] }]
        : [],
    }));
    await page.route('**/api/im/config**', async (route) => {
      savedPayload = JSON.parse(route.request().postData() ?? '{}');
      connected = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, platform: 'dingtalk' }),
      });
    });

    await gotoChannel(page, 'dingtalk');
    await page.getByPlaceholder('https://oapi.dingtalk.com/robot/send?access_token=...').fill('https://oapi.dingtalk.com/robot/send?access_token=abc');

    await expect(page.getByPlaceholder('SECxxxxxxxxxxxxxxxx')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();

    expect(savedPayload).toEqual({
      platform: 'dingtalk',
      credentials: { webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=abc' },
    });
  });

  test('save failure explains the problem and keeps user input', async ({ page }) => {
    await mockStatus(page, () => ({ platforms: [] }));
    await page.route('**/api/im/config**', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Invalid bot token format' }),
      });
    });

    await gotoChannel(page, 'telegram');
    const tokenInput = page.getByPlaceholder('123456789:AABBccDD-EeFfGgHh...');
    await tokenInput.fill('not-a-token');

    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Invalid bot token format')).toBeVisible();
    await expect(tokenInput).toHaveValue('not-a-token');
    await expect(page.getByText('Manual setup')).toBeVisible();
  });

  test('connected channel can test send, rotate credentials, and disconnect safely', async ({ page }) => {
    let connected = true;
    let testPayload: any = null;
    let updatePayload: any = null;
    let deleteSeen = false;

    await mockStatus(page, () => ({
      platforms: connected
        ? [{
          platform: 'telegram',
          connected: true,
          botName: 'Telegram Bot',
          capabilities: ['text'],
        }]
        : [],
    }));
    await page.route('**/api/im/test**', async (route) => {
      testPayload = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, messageId: 'msg_123' }),
      });
    });
    await page.route('**/api/im/config**', async (route) => {
      if (route.request().method() === 'PUT') {
        updatePayload = JSON.parse(route.request().postData() ?? '{}');
      }
      if (route.request().method() === 'DELETE') {
        deleteSeen = true;
        connected = false;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, platform: 'telegram' }),
      });
    });

    await gotoChannel(page, 'telegram');
    await expect(page.getByText('Connected')).toBeVisible();
    await expect(page.locator('main').getByText('Telegram Bot').first()).toBeVisible();

    const sendPanel = page.locator('details').filter({ hasText: 'Send sample notification' });
    await sendPanel.locator('summary').click();
    await page.getByRole('textbox', { name: 'Recipient ID' }).fill('123456789');
    await page.getByRole('button', { name: 'Send sample notification' }).last().click();
    await expect(page.getByText(/Sent successfully.*msg_123/)).toBeVisible();
    expect(testPayload).toEqual({
      platform: 'telegram',
      recipient_id: '123456789',
      message: 'Hello from MindOS',
    });

    const settingsPanel = page.locator('details').filter({ hasText: 'Settings' });
    await settingsPanel.locator('summary').click();
    await settingsPanel.getByPlaceholder('123456789:AABBccDD-EeFfGgHh...').fill('123456789:ROTATEDtoken');
    await settingsPanel.getByRole('button', { name: 'Save' }).click();
    await expect(settingsPanel.getByText(/Saved.*reconnecting/)).toBeVisible();
    expect(updatePayload).toEqual({
      platform: 'telegram',
      credentials: { bot_token: '123456789:ROTATEDtoken' },
    });

    await settingsPanel.getByRole('button', { name: 'Disconnect' }).click();
    await settingsPanel.getByRole('button', { name: 'Confirm?' }).click();
    await expect(page.getByText('Manual setup')).toBeVisible();
    expect(deleteSeen).toBe(true);
  });

  test('Telegram setup visual layout is stable on desktop and mobile', async ({ page }) => {
    await mockStatus(page, () => ({ platforms: [] }));

    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoChannel(page, 'telegram');
    await expect(page.getByText('Connection options')).toBeVisible();
    await expect(page.getByText('Create bot with BotFather')).toBeVisible();
    await expectQrReady(page);
    await page.screenshot({ path: '/tmp/channel-friendly-setup-telegram-desktop-polished.png', fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoChannel(page, 'telegram');

    await expect(page.getByText('Connection options')).toBeVisible();
    await expect(page.getByText('Create bot with BotFather')).toBeVisible();
    await expect(page.getByText('Manual setup')).toBeVisible();
    await expectQrReady(page);

    const metrics = await page.evaluate(() => {
      const main = document.querySelector('main');
      const mainRect = main?.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        mainOverflow: mainRect ? Math.max(0, mainRect.right - window.innerWidth) : 0,
        visibleActionOverflow: Array.from(document.querySelectorAll('main button, main a')).filter((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          return rect.left < -1 || rect.right > window.innerWidth + 1;
        }).length,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.mainOverflow).toBe(0);
    expect(metrics.visibleActionOverflow).toBe(0);

    await page.screenshot({ path: '/tmp/channel-friendly-setup-telegram-mobile.png', fullPage: true });
  });
});

async function mockChannelApis(page: Page): Promise<void> {
  await page.route('**/api/im/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ platforms: [] }),
    });
  });
  await page.route('**/api/im/activity**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ activities: [] }),
    });
  });
  await page.route('**/api/im/test**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: `Unexpected ${route.request().method()} /api/im/test in e2e mock` }),
    });
  });
  await page.route('**/api/im/config**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: `Unexpected ${route.request().method()} /api/im/config in e2e mock` }),
    });
  });
}

async function mockStatus(page: Page, payload: () => { platforms: any[] }): Promise<void> {
  await page.route('**/api/im/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload()),
    });
  });
}

async function gotoChannel(page: Page, platformId: string): Promise<void> {
  await page.goto(`/agents?tab=channels&platform=${platformId}`, { waitUntil: 'domcontentloaded' });
}

async function expectQrReady(page: Page): Promise<void> {
  await expect(page.getByText('No credentials are embedded.')).toBeVisible();
  await expect(page.getByTestId('setup-qr-image').first()).toBeVisible({ timeout: 20_000 });
}
