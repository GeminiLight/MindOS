import type {
  Api,
  Context,
  Model,
  ModelThinkingLevel,
} from '@earendil-works/pi-ai';

type PiAiModule = typeof import('@earendil-works/pi-ai');
type PiBuiltinProvidersModule = typeof import('@earendil-works/pi-ai/providers/all');

let piModulesPromise: Promise<{
  pi: PiAiModule;
  providers: PiBuiltinProvidersModule;
}> | undefined;
let builtinCatalogPromise: Promise<ReturnType<PiBuiltinProvidersModule['builtinModels']>> | undefined;

async function loadPiModules() {
  piModulesPromise ??= Promise.all([
    import('@earendil-works/pi-ai'),
    import('@earendil-works/pi-ai/providers/all'),
  ]).then(([pi, providers]) => ({ pi, providers }));
  return piModulesPromise;
}

async function getBuiltinCatalog() {
  builtinCatalogPromise ??= loadPiModules().then(({ providers }) => providers.builtinModels());
  return builtinCatalogPromise;
}

export async function getPiBuiltinModel(
  provider: string,
  modelId: string,
): Promise<Model<Api> | undefined> {
  return (await getBuiltinCatalog()).getModel(provider, modelId);
}

export async function listPiBuiltinModels(provider: string): Promise<readonly Model<Api>[]> {
  return (await getBuiltinCatalog()).getModels(provider);
}

export async function getPiSupportedThinkingLevels(
  model: Model<Api>,
): Promise<ModelThinkingLevel[]> {
  const { pi } = await loadPiModules();
  return pi.getSupportedThinkingLevels(model);
}

export async function completeWithPiModels(
  model: Model<Api>,
  context: Context,
  input: {
    apiKey?: string;
    signal?: AbortSignal;
  } = {},
) {
  const { pi, providers } = await loadPiModules();
  const credentials = new pi.InMemoryCredentialStore();
  if (input.apiKey) {
    await credentials.modify(model.provider, async () => ({
      type: 'api_key',
      key: input.apiKey,
    }));
  }
  const models = providers.builtinModels({ credentials });
  return models.complete(model, context, {
    ...(input.signal ? { signal: input.signal } : {}),
  });
}
