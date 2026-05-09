export type MindosPluginPermission = {
  id: string;
  description: string;
  default?: 'allow' | 'ask' | 'deny';
};

export type MindosPluginToolContribution = {
  id: string;
  description: string;
  permission?: string;
};

export type MindosPluginManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions?: MindosPluginPermission[];
  tools?: MindosPluginToolContribution[];
};

export type MindosPlugin = {
  manifest: MindosPluginManifest;
};

function isIdentifier(value: string) {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

export function validateMindosPluginManifest(manifest: MindosPluginManifest): string[] {
  const errors: string[] = [];
  if (!manifest.id || !isIdentifier(manifest.id)) errors.push('plugin id must be a non-empty identifier');
  if (!manifest.name?.trim()) errors.push('plugin name is required');
  if (!manifest.version?.trim()) errors.push('plugin version is required');

  const permissionIds = new Set<string>();
  for (const permission of manifest.permissions ?? []) {
    if (!permission.id || !isIdentifier(permission.id)) errors.push(`invalid permission id: ${permission.id}`);
    if (permissionIds.has(permission.id)) errors.push(`duplicate permission id: ${permission.id}`);
    permissionIds.add(permission.id);
  }

  const toolIds = new Set<string>();
  for (const tool of manifest.tools ?? []) {
    if (!tool.id || !isIdentifier(tool.id)) errors.push(`invalid tool id: ${tool.id}`);
    if (toolIds.has(tool.id)) errors.push(`duplicate tool id: ${tool.id}`);
    toolIds.add(tool.id);
    if (tool.permission && !permissionIds.has(tool.permission)) {
      errors.push(`tool "${tool.id}" references unknown permission "${tool.permission}"`);
    }
  }

  return errors;
}

export function defineMindosPlugin(manifest: MindosPluginManifest): MindosPlugin {
  const errors = validateMindosPluginManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Invalid MindOS plugin manifest: ${errors.join('; ')}`);
  }
  return { manifest };
}
