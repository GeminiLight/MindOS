export const MINDOS_CORE_COMMANDS = [
  'agent',
  'ask',
  'start',
  'stop',
  'status',
  'open',
  'file',
  'space',
  'search',
  'mcp',
  'init',
  'config',
  'channel',
  'feishu-ws',
  'doctor',
  'update',
];

export const MINDOS_ADDITIONAL_COMMANDS = [
  'dev',
  'build',
  'restart',
  'sync',
  'gateway',
  'token',
  'logs',
  'api',
  'init-skills',
  'uninstall',
];

export function createCommandRegistry(commandModules) {
  const commands = {};
  for (const mod of commandModules) {
    commands[mod.meta.name] = mod;
    if (mod.meta.aliases) {
      for (const alias of mod.meta.aliases) commands[alias] = mod;
    }
  }
  return commands;
}

export function commandEntries(commandNames, commandModulesByName) {
  return commandNames.map((name) => {
    const mod = commandModulesByName[name];
    if (!mod) {
      throw new Error(`Missing MindOS CLI command module: ${name}`);
    }
    return [name, mod];
  });
}
