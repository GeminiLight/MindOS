import type {
  ImFeishuLongConnectionServices,
  MindosChannelServices,
} from '@geminilight/mindos/server';
import * as imActivity from '@/lib/im/activity';
import * as imConfig from '@/lib/im/config';
import * as imExecutor from '@/lib/im/executor';
import { getFeishuWSClientStatus } from '@/lib/im/feishu-ws-status';
import type { FeishuConfig, IMPlatform } from '@/lib/im/types';
import * as imVerify from '@/lib/im/verify';
import * as feishuStatus from '@/lib/im/webhook/feishu-status';

/**
 * IM channel capabilities owned by the Web host: the `im.json` store (with
 * lark-cli credential references resolved for reads), the adapters that send
 * and verify, and the Feishu long-connection client that lives in this
 * process. Every `@/lib/im` export is reached inside a function so a route only
 * touches the modules its handler needs (tests mock `@/lib/im/*` partially per
 * route), and the Lark SDK behind the long connection is loaded on first start.
 */
export function createWebChannelServices(): MindosChannelServices {
  return {
    verifyCredentials: (platform, credentials) => imVerify.verifyIMCredentials(platform as IMPlatform, credentials),
    readConfig: () => imConfig.readEffectiveIMConfig(),
    // OAuth writes tokens back into what it read; stored config keeps external secrets out of im.json.
    readStoredConfig: () => imConfig.readIMConfig(),
    writeConfig: (config) => imConfig.writeIMConfig(config as ReturnType<typeof imConfig.readIMConfig>),
    hasAnyIMConfig: () => imConfig.hasAnyIMConfig(),
    listConfiguredIM: async () => imExecutor.listConfiguredIM() as never,
    getPlatformConfig: (platform) => (imConfig.getPlatformConfig as (platform: IMPlatform) => unknown)(platform as IMPlatform),
    buildFeishuWebhookStatus: (config) => feishuStatus.buildFeishuWebhookStatus(config as FeishuConfig | undefined) as never,
    sendIMMessage: (message, signal, options) => imExecutor.sendIMMessage(message as never, signal, options) as never,
    getActivities: (platform, limit) => imActivity.getActivities(platform as IMPlatform, limit) as never,
    getFeishuWSClientStatus: () => getFeishuWSClientStatus(),
    startFeishuWSClient: async (config) => {
      const client = await loadFeishuWSClient();
      await client.startFeishuWSClient(config as FeishuConfig);
    },
    stopFeishuWSClient,
  };
}

type FeishuWSClientModule = typeof import('@/lib/im/feishu-ws-client');

let feishuWSClient: FeishuWSClientModule | undefined;

async function loadFeishuWSClient(): Promise<FeishuWSClientModule> {
  feishuWSClient ??= await import('@/lib/im/feishu-ws-client');
  return feishuWSClient;
}

/**
 * Stop is synchronous in the handler contract. When the client module is
 * already loaded (it started through this process) the stop is immediate;
 * otherwise nothing started here is running, and a client started elsewhere in
 * the process is stopped as soon as the module resolves.
 */
const stopFeishuWSClient: NonNullable<ImFeishuLongConnectionServices['stopFeishuWSClient']> = () => {
  if (feishuWSClient) {
    feishuWSClient.stopFeishuWSClient();
    return;
  }
  if (!getFeishuWSClientStatus().running) return;
  void loadFeishuWSClient().then((client) => client.stopFeishuWSClient()).catch(() => {});
};
