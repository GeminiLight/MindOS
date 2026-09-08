import { handleChannelsVerifyPost } from '../handlers/channels-verify.js';
import { handleImActivityGet } from '../handlers/im-activity.js';
import { handleImConfigDelete, handleImConfigGet, handleImConfigPut } from '../handlers/im-config.js';
import {
  handleImFeishuLongConnectionDelete,
  handleImFeishuLongConnectionGet,
  handleImFeishuLongConnectionPost,
} from '../handlers/im-feishu-long-connection.js';
import { handleImFeishuOAuthCallbackGet, handleImFeishuOAuthGet } from '../handlers/im-feishu-oauth.js';
import { handleImStatusGet, handleImWebhookStatusGet } from '../handlers/im-status.js';
import { handleImTestPost } from '../handlers/im-test.js';
import { defineRoutes } from '../route-table.js';

export const imRoutes = defineRoutes([
  { id: 'channels.verify', method: 'POST', path: '/api/channels/verify', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleChannelsVerifyPost(await readJsonBody(), services.channels) },
  { id: 'im.activity', method: 'GET', path: '/api/im/activity', auth: 'required',
    handler: ({ query }) => handleImActivityGet(query) },
  { id: 'im.config', method: 'GET', path: '/api/im/config', auth: 'required',
    handler: ({ services }) => handleImConfigGet(services.channels) },
  { id: 'im.config.update', method: 'PUT', path: '/api/im/config', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleImConfigPut(await readJsonBody(), services.channels) },
  { id: 'im.config.delete', method: 'DELETE', path: '/api/im/config', auth: 'required',
    handler: ({ query, services }) => handleImConfigDelete(query, services.channels) },
  { id: 'im.status', method: 'GET', path: '/api/im/status', auth: 'required',
    handler: ({ services }) => handleImStatusGet(services.channels) },
  { id: 'im.test', method: 'POST', path: '/api/im/test', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleImTestPost(await readJsonBody(), services.channels) },
  { id: 'im.webhook-status', method: 'GET', path: '/api/im/webhook-status', auth: 'required',
    handler: ({ query, services }) => handleImWebhookStatusGet(query, services.channels) },
  { id: 'im.feishu.oauth', method: 'GET', path: '/api/im/feishu/oauth', auth: 'required',
    handler: ({ query }) => handleImFeishuOAuthGet(query) },
  { id: 'im.feishu.oauth.callback', method: 'GET', path: '/api/im/feishu/oauth/callback', auth: 'public',
    handler: ({ query }) => handleImFeishuOAuthCallbackGet(query) },
  { id: 'im.feishu.long-connection', method: 'GET', path: '/api/im/feishu/long-connection', auth: 'required',
    handler: () => handleImFeishuLongConnectionGet() },
  { id: 'im.feishu.long-connection.start', method: 'POST', path: '/api/im/feishu/long-connection', auth: 'required',
    handler: () => handleImFeishuLongConnectionPost() },
  { id: 'im.feishu.long-connection.stop', method: 'DELETE', path: '/api/im/feishu/long-connection', auth: 'required',
    handler: () => handleImFeishuLongConnectionDelete() },
]);
