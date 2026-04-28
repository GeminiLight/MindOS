export declare const MINDOS_CORE_COMMANDS: readonly string[];
export declare const MINDOS_ADDITIONAL_COMMANDS: readonly string[];

export interface MindosCliCommandModule {
  meta: {
    name: string;
    aliases?: readonly string[];
    summary?: string;
  };
}

export declare function createCommandRegistry<T extends MindosCliCommandModule>(
  commandModules: readonly T[],
): Record<string, T>;

export declare function commandEntries<T extends MindosCliCommandModule>(
  commandNames: readonly string[],
  commandModulesByName: Record<string, T>,
): Array<[string, T]>;
