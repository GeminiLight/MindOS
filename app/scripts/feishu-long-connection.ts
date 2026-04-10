import { getPlatformConfig } from '@/lib/im/config';
import { startFeishuWSClient, getFeishuWSClientStatus } from '@/lib/im/feishu-ws-client';

async function main() {
  const config = getPlatformConfig('feishu');
  if (!config) {
    throw new Error('Feishu is not configured. Save App ID and App Secret first.');
  }

  await startFeishuWSClient(config);
  const status = getFeishuWSClientStatus();

  console.log('[feishu/ws] status:', JSON.stringify(status, null, 2));
  console.log('[feishu/ws] connected. Keep this process running to receive events.');

  process.on('SIGINT', () => {
    console.log('\n[feishu/ws] shutting down');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[feishu/ws] shutting down');
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch((error) => {
  console.error('[feishu/ws] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
