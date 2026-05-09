import {
  applyMindosSetupConfig,
  buildMindosSetupState,
  patchMindosSetupGuideState,
  type MindosSetupServices,
  type MindosSetupStatePayload,
} from '../../setup/index.js';
import type { MindosServerResponse } from '../response.js';

export type SetupWizardServices = MindosSetupServices;

export function handleSetupGet(
  services: SetupWizardServices,
): MindosServerResponse<MindosSetupStatePayload> {
  return buildMindosSetupState(services);
}

export function handleSetupPost(
  body: unknown,
  services: SetupWizardServices,
): ReturnType<typeof applyMindosSetupConfig> {
  return applyMindosSetupConfig(body, services);
}

export function handleSetupPatch(
  body: unknown,
  services: SetupWizardServices,
): ReturnType<typeof patchMindosSetupGuideState> {
  return patchMindosSetupGuideState(body, services);
}

export type {
  MindosSetupAiConfig,
  MindosSetupGuideState,
  MindosSetupProvider,
  MindosSetupProviderPreset,
  MindosSetupServices,
  MindosSetupSettings,
  MindosSetupStatePayload,
} from '../../setup/index.js';
