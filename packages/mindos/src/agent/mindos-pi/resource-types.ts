export type MindosDiscoveredSkill = {
  name: string;
  disableModelInvocation?: boolean;
};

export type MindosExtensionLoadResult = {
  extensions?: MindosExtensionEntry[];
  errors?: Array<{ path: string; error: string }>;
};

export type MindosExtensionEntry = {
  path?: string;
  tools?: unknown;
};

export type MindosExtensionLoadError = { path: string; error: string };

export type MindosPiResourceLoaderAdapter = {
  reload(): Promise<void>;
  getSkills?(): { skills: MindosDiscoveredSkill[] };
  getExtensions?(): MindosExtensionLoadResult;
};
