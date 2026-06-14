/**
 * Obsidian Plugin Compatibility - Command Registry
 * Central registry for all plugin-registered commands
 */

import type { Command, Editor, MarkdownView } from './types';

export interface RegisteredCommand extends Command {
  pluginId: string;
  fullId: string; // obsidian:{pluginId}:{commandId}
}

export type CommandCallbackType =
  | 'callback'
  | 'check-callback'
  | 'editor-callback'
  | 'editor-check-callback'
  | 'none';

export interface CommandAvailability {
  executable: boolean;
  requiresEditor: boolean;
  callbackType: CommandCallbackType;
  reason?: string;
}

export interface CommandExecutionContext {
  editor?: Editor;
  view?: MarkdownView;
}

export function describeCommandAvailability(command: Command, context: CommandExecutionContext = {}): CommandAvailability {
  if (command.checkCallback) {
    try {
      const result = command.checkCallback(true);
      if (result === true) {
        return {
          executable: true,
          requiresEditor: false,
          callbackType: 'check-callback',
        };
      }

      return {
        executable: false,
        requiresEditor: false,
        callbackType: 'check-callback',
        reason: 'checkCallback(true) did not mark this command available in the current MindOS context.',
      };
    } catch (error) {
      return {
        executable: false,
        requiresEditor: false,
        callbackType: 'check-callback',
        reason: `checkCallback(true) failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (command.callback) {
    return {
      executable: true,
      requiresEditor: false,
      callbackType: 'callback',
    };
  }

  if (command.editorCheckCallback) {
    if (!context.editor || !context.view) {
      return {
        executable: false,
        requiresEditor: true,
        callbackType: 'editor-check-callback',
        reason: 'This Obsidian editor command requires an active Markdown editor context.',
      };
    }

    try {
      const result = command.editorCheckCallback(true, context.editor, context.view);
      if (result === true) {
        return {
          executable: true,
          requiresEditor: true,
          callbackType: 'editor-check-callback',
        };
      }
      return {
        executable: false,
        requiresEditor: true,
        callbackType: 'editor-check-callback',
        reason: 'editorCheckCallback(true) did not mark this command available in the current Markdown editor context.',
      };
    } catch (error) {
      return {
        executable: false,
        requiresEditor: true,
        callbackType: 'editor-check-callback',
        reason: `editorCheckCallback(true) failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (command.editorCallback) {
    if (context.editor && context.view) {
      return {
        executable: true,
        requiresEditor: true,
        callbackType: 'editor-callback',
      };
    }
    return {
      executable: false,
      requiresEditor: true,
      callbackType: 'editor-callback',
      reason: 'This Obsidian editor command requires an active Markdown editor context.',
    };
  }

  return {
    executable: false,
    requiresEditor: false,
    callbackType: 'none',
    reason: 'This command did not register an executable callback.',
  };
}

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();

  /**
   * Register a command from a plugin.
   */
  register(pluginId: string, command: Command): RegisteredCommand {
    const fullId = `obsidian:${pluginId}:${command.id}`;

    // Duplicate registration replaces the previous command deterministically.

    const registered: RegisteredCommand = {
      ...command,
      pluginId,
      fullId,
    };

    this.commands.set(fullId, registered);
    return registered;
  }

  /**
   * Unregister a command by plugin + command ID.
   */
  unregister(pluginId: string, commandId: string): void {
    const fullId = `obsidian:${pluginId}:${commandId}`;
    this.commands.delete(fullId);
  }

  /**
   * Unregister all commands from a plugin.
   */
  unregisterAll(pluginId: string): void {
    for (const [fullId] of Array.from(this.commands.entries())) {
      if (fullId.startsWith(`obsidian:${pluginId}:`)) {
        this.commands.delete(fullId);
      }
    }
  }

  /**
   * List all registered commands.
   */
  list(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get a specific command by full ID.
   */
  get(fullId: string): RegisteredCommand | undefined {
    return this.commands.get(fullId);
  }

  getAvailability(fullId: string, context?: CommandExecutionContext): CommandAvailability {
    const cmd = this.commands.get(fullId);
    if (!cmd) {
      throw new Error(`Command not found: ${fullId}`);
    }
    return describeCommandAvailability(cmd, context);
  }

  /**
   * Execute a command by full ID (calls callback if available).
   */
  async execute(fullId: string, context: CommandExecutionContext = {}): Promise<void> {
    const cmd = this.commands.get(fullId);
    if (!cmd) {
      throw new Error(`Command not found: ${fullId}`);
    }

    const availability = describeCommandAvailability(cmd, context);
    if (!availability.executable) {
      throw new Error(`Command is not available: ${fullId}${availability.reason ? ` (${availability.reason})` : ''}`);
    }

    try {
      if (cmd.checkCallback) {
        await cmd.checkCallback(false);
      } else if (cmd.callback) {
        await cmd.callback();
      } else if (cmd.editorCheckCallback && context.editor && context.view) {
        await cmd.editorCheckCallback(false, context.editor, context.view);
      } else if (cmd.editorCallback && context.editor && context.view) {
        await cmd.editorCallback(context.editor, context.view);
      } else {
        throw new Error(`Command has no executable callback: ${fullId}`);
      }
    } catch (err) {
      console.error(`[obsidian-compat] Command execution failed: ${fullId}`, err);
      throw err;
    }
  }
}
