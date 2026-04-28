/**
 * Obsidian Plugin Compatibility - Command Registry
 * Central registry for all plugin-registered commands
 */

import { Command } from './types';

export interface RegisteredCommand extends Command {
  pluginId: string;
  fullId: string; // obsidian:{pluginId}:{commandId}
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

  /**
   * Execute a command by full ID (calls callback if available).
   */
  async execute(fullId: string): Promise<void> {
    const cmd = this.commands.get(fullId);
    if (!cmd) {
      throw new Error(`Command not found: ${fullId}`);
    }

    try {
      if (cmd.callback) {
        cmd.callback();
      }
    } catch (err) {
      console.error(`[obsidian-compat] Command execution failed: ${fullId}`, err);
      throw err;
    }
  }
}
