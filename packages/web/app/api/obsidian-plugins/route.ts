export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';
import type { PluginEditorCommandContext } from '@/lib/obsidian-compat/plugin-manager';
import { isObsidianCapabilityGateConfirmationRequiredError } from '@/lib/obsidian-compat/capability-gate';
import { isObsidianWorkflowProbeId, type ObsidianWorkflowProbeId } from '@/lib/obsidian-compat/workflow-probes';

type PluginAction = 'enable' | 'disable' | 'load' | 'load-enabled' | 'execute-command' | 'run-workflow-probe' | 'execute-ribbon-action' | 'choose-modal-suggestion' | 'choose-menu-item' | 'uninstall' | 'migrate-legacy';

const VALID_PLUGIN_ACTIONS: PluginAction[] = [
  'enable',
  'disable',
  'load',
  'load-enabled',
  'execute-command',
  'run-workflow-probe',
  'execute-ribbon-action',
  'choose-modal-suggestion',
  'choose-menu-item',
  'uninstall',
  'migrate-legacy',
];

function requirePluginId(action: PluginAction, pluginId: unknown): string {
  if (typeof pluginId !== 'string' || pluginId.trim().length === 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Missing pluginId for ${action}`);
  }
  return pluginId.trim();
}

function requireCommandId(commandId: unknown): string {
  if (typeof commandId !== 'string' || commandId.trim().length === 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing commandId for execute-command');
  }
  return commandId.trim();
}

function parseEditorContext(raw: unknown): PluginEditorCommandContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  if (typeof source.sourcePath !== 'string' || source.sourcePath.trim().length === 0) return undefined;
  return {
    sourcePath: source.sourcePath.trim(),
    ...(typeof source.selectionStart === 'number' ? { selectionStart: source.selectionStart } : {}),
    ...(typeof source.selectionEnd === 'number' ? { selectionEnd: source.selectionEnd } : {}),
    ...(typeof source.cursorOffset === 'number' ? { cursorOffset: source.cursorOffset } : {}),
  };
}

function requireRibbonIndex(index: unknown): number {
  if (!Number.isInteger(index) || Number(index) < 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing or invalid ribbonIndex for execute-ribbon-action');
  }
  return Number(index);
}

function requireModalId(modalId: unknown): string {
  if (typeof modalId !== 'string' || modalId.trim().length === 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing modalId for choose-modal-suggestion');
  }
  return modalId.trim();
}

function requireSuggestionIndex(index: unknown): number {
  if (!Number.isInteger(index) || Number(index) < 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing or invalid suggestionIndex for choose-modal-suggestion');
  }
  return Number(index);
}

function requireMenuId(menuId: unknown): string {
  if (typeof menuId !== 'string' || menuId.trim().length === 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing menuId for choose-menu-item');
  }
  return menuId.trim();
}

function requireMenuItemIndex(index: unknown): number {
  if (!Number.isInteger(index) || Number(index) < 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing or invalid itemIndex for choose-menu-item');
  }
  return Number(index);
}

function requireInteractionId(action: PluginAction, interactionId: unknown): string {
  if (typeof interactionId !== 'string' || interactionId.trim().length === 0) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Missing interactionId for ${action}`);
  }
  return interactionId.trim();
}

function parseProbeId(probeId: unknown): ObsidianWorkflowProbeId | undefined {
  if (typeof probeId !== 'string' || probeId.trim().length === 0) return undefined;
  const trimmed = probeId.trim();
  if (!isObsidianWorkflowProbeId(trimmed)) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Unknown workflow probe id: ${trimmed}`);
  }
  return trimmed;
}

export async function GET(req: NextRequest) {
  try {
    const settings = readSettings();
    const shouldLoadEnabled = req.nextUrl.searchParams.get('loadEnabled') === '1';

    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const result = shouldLoadEnabled ? await manager.loadEnabledPlugins() : undefined;
      return NextResponse.json({
        ok: true,
        result,
        plugins: manager.list(),
      });
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action?: PluginAction;
      pluginId?: string;
      commandId?: string;
      ribbonIndex?: number;
      modalId?: string;
      suggestionIndex?: number;
      menuId?: string;
      itemIndex?: number;
      interactionId?: string;
      editorContext?: unknown;
      probeId?: string;
      confirmCapabilityGate?: boolean;
    };
    const action = body.action;
    if (!action || !VALID_PLUGIN_ACTIONS.includes(action)) {
      return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }

    const settings = readSettings();

    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      let result: unknown = null;

      if (action === 'enable') {
        await manager.enable(requirePluginId(action, body.pluginId), {
          confirmCapabilityGate: body.confirmCapabilityGate === true,
        });
      } else if (action === 'disable') {
        await manager.disable(requirePluginId(action, body.pluginId));
      } else if (action === 'load') {
        await manager.load(requirePluginId(action, body.pluginId), {
          confirmCapabilityGate: body.confirmCapabilityGate === true,
        });
      } else if (action === 'load-enabled') {
        result = await manager.loadEnabledPlugins();
      } else if (action === 'uninstall') {
        await manager.uninstall(requirePluginId(action, body.pluginId));
      } else if (action === 'migrate-legacy') {
        result = await manager.migrateLegacyPlugin(requirePluginId(action, body.pluginId));
      } else if (action === 'execute-command') {
        result = await manager.executeCommand(requireCommandId(body.commandId), {
          editor: parseEditorContext(body.editorContext),
        });
      } else if (action === 'run-workflow-probe') {
        result = await manager.runWorkflowProbe(
          requirePluginId(action, body.pluginId),
          parseProbeId(body.probeId),
        );
      } else if (action === 'execute-ribbon-action') {
        result = await manager.executeRibbonIcon(
          requirePluginId(action, body.pluginId),
          requireRibbonIndex(body.ribbonIndex),
        );
      } else if (action === 'choose-modal-suggestion') {
        result = await manager.chooseModalSuggestion(
          requireModalId(body.modalId),
          requireSuggestionIndex(body.suggestionIndex),
          requireInteractionId(action, body.interactionId),
        );
      } else {
        result = await manager.chooseMenuItem(
          requireMenuId(body.menuId),
          requireMenuItemIndex(body.itemIndex),
          requireInteractionId(action, body.interactionId),
        );
      }

      return NextResponse.json({
        ok: true,
        result,
        plugins: manager.list(),
      });
    });
  } catch (err) {
    if (isObsidianCapabilityGateConfirmationRequiredError(err)) {
      return NextResponse.json({
        ok: false,
        error: err.message,
        capabilityGate: err.report,
      }, { status: 409 });
    }
    return handleRouteErrorSimple(err);
  }
}
