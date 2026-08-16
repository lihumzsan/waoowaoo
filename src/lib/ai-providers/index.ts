import { AiRegistry } from "@/lib/ai-registry/registry";
import type {
  AsyncExternalIdProvider,
  AsyncTaskProviderRegistration,
} from "@/lib/ai-providers/async-task-types";
import { codexAdapter } from "@/lib/ai-providers/codex/adapter";
import { comfyuiAdapter } from "@/lib/ai-providers/comfyui/adapter";
import { comfyuiAsyncTaskProvider } from "@/lib/ai-providers/comfyui/async-task";
import type { AiProviderAdapter } from "@/lib/ai-providers/runtime-types";
import {
  assertProviderFailureAdapterIdentity,
  runCapturedProviderOperation,
} from "@/lib/ai-providers/failure";
import type { AiProviderFailurePhase } from "@/lib/ai-providers/runtime-types";
import type { ExternalOperationId } from "@/lib/external-operation/registry";

const runtimeProviderRegistry = new AiRegistry<AiProviderAdapter>([
  codexAdapter,
  comfyuiAdapter,
]);

for (const adapter of runtimeProviderRegistry.getAdapters()) {
  assertProviderFailureAdapterIdentity(adapter.providerKey, adapter.failure);
}
const asyncTaskProviderRegistry: AsyncTaskProviderRegistration[] = [
  comfyuiAsyncTaskProvider,
];

for (const registration of asyncTaskProviderRegistry) {
  resolveAiProviderAdapter(registration.providerKey);
}

export function resolveAsyncTaskProviderByExternalId(
  externalId: string,
): AsyncTaskProviderRegistration {
  const registration = asyncTaskProviderRegistry.find((candidate) =>
    candidate.canParseExternalId(externalId),
  );
  if (!registration) {
    throw new Error(
      `无法识别的 externalId 格式: "${externalId}". ` +
        `支持的格式: COMFYUI:<targetId>:VIDEO|MUSIC|SOUND|VOICE:promptId`,
    );
  }
  return registration;
}

export function resolveAsyncTaskProviderByCode(
  providerCode: AsyncExternalIdProvider,
): AsyncTaskProviderRegistration {
  const registration = asyncTaskProviderRegistry.find(
    (candidate) => candidate.providerCode === providerCode,
  );
  if (!registration) {
    throw new Error(`未知的 Provider: ${providerCode}`);
  }
  return registration;
}

export function listRegisteredAsyncTaskProviders(): readonly AsyncTaskProviderRegistration[] {
  return [...asyncTaskProviderRegistry];
}

export function resolveAiProviderAdapter(
  providerId: string,
): AiProviderAdapter {
  return runtimeProviderRegistry.getAdapterByProviderId(providerId);
}

export function tryResolveAiProviderAdapter(
  providerId: string,
): AiProviderAdapter | null {
  return runtimeProviderRegistry.tryGetAdapterByProviderId(providerId);
}

export function listRegisteredAiProviderAdapters(): readonly AiProviderAdapter[] {
  return runtimeProviderRegistry.getAdapters();
}

export async function runRegisteredProviderOperation<T>(input: {
  readonly providerId: string;
  readonly phase: AiProviderFailurePhase;
  readonly operation?: ExternalOperationId;
  readonly run: () => Promise<T>;
}): Promise<T> {
  const adapter = resolveAiProviderAdapter(input.providerId);
  return await runCapturedProviderOperation({
    adapter: adapter.failure,
    phase: input.phase,
    operation: input.operation,
    run: input.run,
  });
}
