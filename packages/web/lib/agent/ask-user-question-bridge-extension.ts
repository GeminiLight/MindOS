import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti/static';
import { askUserQuestionViaBridge, hasAskUserQuestionBridge } from '@geminilight/mindos/agent/user-question-bridge';

type ToolWithRuntimeContext = ToolDefinition & {
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: Record<string, any>,
  ) => Promise<any> | any;
};

type RegisterAskUserQuestionExtension = (pi: ExtensionAPI) => void | Promise<void>;

async function loadUpstreamAskUserQuestionExtension(): Promise<RegisterAskUserQuestionExtension> {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    tryNative: false,
  });
  const register = await jiti.import('@juicesharp/rpiv-ask-user-question', { default: true });
  if (typeof register !== 'function') {
    throw new Error('@juicesharp/rpiv-ask-user-question did not export an extension factory.');
  }
  return register as RegisterAskUserQuestionExtension;
}

function wrapAskUserQuestionTool(tool: ToolWithRuntimeContext): ToolWithRuntimeContext {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!hasAskUserQuestionBridge() || !ctx) {
        return await tool.execute(toolCallId, params, signal, onUpdate, ctx);
      }

      const bridgedCtx = {
        ...ctx,
        hasUI: true,
        ui: {
          ...(ctx.ui ?? {}),
          custom: async () => askUserQuestionViaBridge({ toolCallId, params, signal }),
        },
      };

      return await tool.execute(toolCallId, params, signal, onUpdate, bridgedCtx);
    },
  };
}

export default async function mindosAskUserQuestionBridgeExtension(pi: ExtensionAPI): Promise<void> {
  const proxyPi = {
    ...pi,
    registerTool(tool: ToolDefinition) {
      if (tool.name === 'ask_user_question') {
        pi.registerTool(wrapAskUserQuestionTool(tool as ToolWithRuntimeContext) as ToolDefinition);
        return;
      }
      pi.registerTool(tool);
    },
  } as ExtensionAPI;

  const registerAskUserQuestionExtension = await loadUpstreamAskUserQuestionExtension();
  await registerAskUserQuestionExtension(proxyPi);
}
