import type { GenerateResult } from "@/lib/ai-providers/runtime-types";
import type { AiModality } from "@/lib/ai-registry/types";
import { resolveModelSelection } from "@/lib/user-api/runtime-config";
import {
  resolveAiProviderAdapter,
  runRegisteredProviderOperation,
} from "@/lib/ai-providers";
import { normalizeMediaOptionsForSelection } from "@/lib/ai-exec/media-preflight";
import { buildTaskMediaLogicalInvocationIdentity } from "@/lib/ai-exec/media-invocation-identity";
import { AppError } from "@/lib/errors/app-error";
import { getLogContext } from "@/lib/logging/context";
import {
  cancelAsyncProviderTaskBestEffort,
  ProviderQueueTimeoutError,
  waitForAsyncProviderResult,
  type AsyncProviderWaitCallbacks,
} from "@/lib/ai-exec/async-wait";
import { ProviderTaskFailureError } from "@/lib/ai-exec/provider-errors";
import { EXTERNAL_OPERATION } from "@/lib/external-operation/registry";
import {
  createMediaProviderRequestIdentity,
  assertImageMediaReferencesUseAbsoluteHttpUrls,
  assertVideoMediaReferencesUseAbsoluteHttpUrls,
} from "@/lib/ai-exec/media-references";
import {
  executeTaskProviderInvocation,
  markTaskProviderInvocationReplayAuthorized,
  type TaskProviderInvocation,
  type TaskProviderInvocationRoute,
} from "@/lib/task/provider-invocation";
import { resolveProviderRouteSet } from "@/lib/ai-registry/provider-route-set";
import type { AiResolvedSelection } from "@/lib/ai-registry/types";
import type {
  MusicKeyScale,
  MusicTimeSignature,
} from "@/lib/workspace-resource/music-parameter-contract";
import {
  logMediaModelSelectionResolved,
  summarizeGenerateResult,
  summarizeMediaRequestInput,
  wrapMediaProviderExecution,
} from "@/lib/ai-exec/media-observe";
import { createScopedLogger } from "@/lib/logging/core";
import type { MusicCompositionPlan } from "@/lib/music/composition-plan";
import { hashCanonicalJson } from "@/lib/operation-plan-contract/canonical-json";

const mediaExecutionLogger = createScopedLogger({ module: "ai-exec.media" });

export type AiMediaExecutionModality = Extract<
  AiModality,
  "image" | "video" | "music" | "sound"
>;

export type AiImageExecutionOptions = {
  referenceImages?: string[];
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
  keepOriginalAspectRatio?: boolean;
  size?: string;
  quality?: string;
  responseFormat?: string;
  background?: string;
  outputCompression?: number;
  moderation?: string;
  [key: string]: string | number | boolean | string[] | undefined;
};
export type AiVideoExecutionOptions = {
  prompt?: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
  lastFrameImageUrl?: string;
  referenceImages?: string[];
  referenceAudios?: string[];
  referenceVideos?: string[];
  continuationVideoUrl?: string;
  [key: string]: string | number | boolean | string[] | undefined;
};

export type AiMusicExecutionOptions = {
  negativePrompt?: string;
  durationSeconds?: number;
  providerDurationSeconds?: number;
  vocalMode?: "instrumental" | "vocal";
  genre?: string;
  mood?: string;
  bpm?: number;
  keyScale?: MusicKeyScale;
  timeSignature?: MusicTimeSignature;
  outputFormat?: "mp3" | "wav";
};

export type AiSoundExecutionOptions = {
  negativePrompt?: string;
  durationSeconds?: number;
  outputFormat?: "mp3";
};

export type AiMediaExecutionInput =
  | {
      modality: "image";
      userId: string;
      modelKey: string;
      prompt: string;
      options?: AiImageExecutionOptions;
    }
  | {
      modality: "video";
      userId: string;
      modelKey: string;
      imageUrl: string;
      options?: AiVideoExecutionOptions;
    }
  | {
      modality: "music";
      userId: string;
      modelKey: string;
      generation:
        | { readonly kind: "prompt"; readonly prompt: string }
        | {
            readonly kind: "composition_plan";
            readonly compositionPlan: MusicCompositionPlan;
          };
      options?: AiMusicExecutionOptions;
    }
  | {
      modality: "sound";
      userId: string;
      modelKey: string;
      prompt: string;
      options?: AiSoundExecutionOptions;
    };

async function executeProviderRouteWithoutFence<TResult>(
  route: TaskProviderInvocationRoute<TResult>,
): Promise<TResult> {
  if (route.prepare) {
    const prepared = await route.prepare();
    try {
      return await prepared.execute();
    } finally {
      try {
        await prepared.cleanup();
      } catch (error) {
        mediaExecutionLogger.warn({
          action: "provider.invocation.cleanup_failed",
          message:
            "prepared provider invocation cleanup failed outside Task execution",
          provider: route.provider,
          details: { modelKey: route.modelKey },
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: String(error) },
        });
      }
    }
  }
  return await route.execute();
}

export async function executeMediaGeneration(
  input: AiMediaExecutionInput,
  invocation?: TaskProviderInvocation,
  wait?: AsyncProviderWaitCallbacks,
): Promise<GenerateResult> {
  if (input.modality === "image") {
    assertImageMediaReferencesUseAbsoluteHttpUrls(input.options);
  } else if (input.modality === "video") {
    assertVideoMediaReferencesUseAbsoluteHttpUrls({
      imageUrl: input.imageUrl,
      options: input.options,
    });
  }
  const selection = await resolveModelSelection(
    input.userId,
    input.modelKey,
    input.modality,
  );
  const taskId = getLogContext().taskId;
  if (taskId && !invocation) {
    throw new Error(
      `TASK_PROVIDER_INVOCATION_KEY_REQUIRED:${taskId}:${input.modality}`,
    );
  }
  const taskLogicalInvocationIdentity = taskId && invocation
    ? buildTaskMediaLogicalInvocationIdentity({
        taskId,
        invocationKey: invocation.key,
      })
    : null;
  logMediaModelSelectionResolved({
    modality: input.modality,
    provider: selection.provider,
    modelKey: selection.modelKey,
  });
  // Descriptor resolution and option normalization are local preflight. They
  // must finish before executeTaskProviderInvocation claims the durable
  // "submitting" fence; only adapter execution may cross that boundary.
  const buildRoute = (
    routeSelection: AiResolvedSelection,
  ): TaskProviderInvocationRoute<GenerateResult> => {
    const adapter = resolveAiProviderAdapter(routeSelection.provider);
    switch (input.modality) {
      case "image": {
        const modalityAdapter = adapter[input.modality];
        if (!modalityAdapter) {
          throw new Error(
            `AI_PROVIDER_MODALITY_UNSUPPORTED:${routeSelection.provider}:${input.modality}`,
          );
        }
        const options = normalizeMediaOptionsForSelection({
          selection: routeSelection,
          modality: input.modality,
          options: input.options,
          prompt: input.prompt,
        }) as AiImageExecutionOptions | undefined;
        const context = {
          userId: input.userId,
          selection: routeSelection,
          prompt: input.prompt,
          options,
        };
        return {
          provider: routeSelection.provider,
          modelKey: routeSelection.modelKey,
          request: createMediaProviderRequestIdentity({
            ...input,
            modelKey: routeSelection.modelKey,
          }),
          ...(modalityAdapter.prepare
            ? { prepare: async () => await modalityAdapter.prepare(context) }
            : { execute: async () => await modalityAdapter.execute(context) }),
        };
      }
      case "video": {
        const modalityAdapter = adapter[input.modality];
        if (!modalityAdapter) {
          throw new Error(
            `AI_PROVIDER_MODALITY_UNSUPPORTED:${routeSelection.provider}:${input.modality}`,
          );
        }
        const options = normalizeMediaOptionsForSelection({
          selection: routeSelection,
          modality: input.modality,
          options: input.options,
          prompt: input.options?.prompt,
        }) as AiVideoExecutionOptions | undefined;
        const request = createMediaProviderRequestIdentity({
          ...input,
          modelKey: routeSelection.modelKey,
        });
        const context = {
          userId: input.userId,
          logicalInvocationIdentity:
            taskLogicalInvocationIdentity
            ?? `direct:${hashCanonicalJson(request)}`,
          selection: routeSelection,
          imageUrl: input.imageUrl,
          options,
        };
        return {
          provider: routeSelection.provider,
          modelKey: routeSelection.modelKey,
          request,
          ...(modalityAdapter.prepare
            ? { prepare: async () => await modalityAdapter.prepare(context) }
            : { execute: async () => await modalityAdapter.execute(context) }),
        };
      }
      case "music": {
        const modalityAdapter = adapter[input.modality];
        if (!modalityAdapter) {
          throw new Error(
            `AI_PROVIDER_MODALITY_UNSUPPORTED:${routeSelection.provider}:${input.modality}`,
          );
        }
        const options = normalizeMediaOptionsForSelection({
          selection: routeSelection,
          modality: input.modality,
          options: input.options,
          prompt:
            input.generation.kind === "prompt"
              ? input.generation.prompt
              : undefined,
          musicGenerationMode: input.generation.kind,
        }) as AiMusicExecutionOptions | undefined;
        const context = {
          userId: input.userId,
          selection: routeSelection,
          generation: input.generation,
          options,
        };
        return {
          provider: routeSelection.provider,
          modelKey: routeSelection.modelKey,
          request: createMediaProviderRequestIdentity({
            ...input,
            modelKey: routeSelection.modelKey,
          }),
          ...(modalityAdapter.prepare
            ? { prepare: async () => await modalityAdapter.prepare(context) }
            : { execute: async () => await modalityAdapter.execute(context) }),
        };
      }
      case "sound": {
        const modalityAdapter = adapter[input.modality];
        if (!modalityAdapter) {
          throw new Error(
            `AI_PROVIDER_MODALITY_UNSUPPORTED:${routeSelection.provider}:${input.modality}`,
          );
        }
        const options = normalizeMediaOptionsForSelection({
          selection: routeSelection,
          modality: input.modality,
          options: input.options,
          prompt: input.prompt,
        }) as AiSoundExecutionOptions | undefined;
        const context = {
          userId: input.userId,
          selection: routeSelection,
          prompt: input.prompt,
          options,
        };
        return {
          provider: routeSelection.provider,
          modelKey: routeSelection.modelKey,
          request: createMediaProviderRequestIdentity({
            ...input,
            modelKey: routeSelection.modelKey,
          }),
          ...(modalityAdapter.prepare
            ? { prepare: async () => await modalityAdapter.prepare(context) }
            : { execute: async () => await modalityAdapter.execute(context) }),
        };
      }
    }
  };
  // Logging-only wrapper around the provider execution throat; it swallows its
  // own failures and rethrows execution errors unchanged (no control-flow change).
  const buildObservedRoute = (
    routeSelection: AiResolvedSelection,
  ): TaskProviderInvocationRoute<GenerateResult> => {
    const route = buildRoute(routeSelection);
    const observation = {
      provider: route.provider,
      modelKey: route.modelKey,
      modality: input.modality,
      phase: "execute" as const,
      requestSummary: () => summarizeMediaRequestInput(input),
    };
    if (route.prepare) {
      return {
        provider: route.provider,
        modelKey: route.modelKey,
        request: route.request,
        prepare: async () => {
          const prepared = await route.prepare();
          return {
            cleanup: prepared.cleanup,
            execute: () =>
              wrapMediaProviderExecution(
                observation,
                async () =>
                  await runRegisteredProviderOperation({
                    providerId: route.provider,
                    phase: "submit",
                    operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
                    run: prepared.execute,
                  }),
                summarizeGenerateResult,
              ),
          };
        },
      };
    }
    return {
      provider: route.provider,
      modelKey: route.modelKey,
      request: route.request,
      execute: () =>
        wrapMediaProviderExecution(
          observation,
          async () =>
            await runRegisteredProviderOperation({
              providerId: route.provider,
              phase: "submit",
              operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
              run: route.execute,
            }),
          summarizeGenerateResult,
        ),
    };
  };
  let result: GenerateResult;
  if (!taskId) {
    result = await executeProviderRouteWithoutFence(
      buildObservedRoute(selection),
    );
  } else {
    if (!invocation) {
      throw new Error(
        `TASK_PROVIDER_INVOCATION_KEY_REQUIRED:${taskId}:${input.modality}`,
      );
    }
    const routeSet = resolveProviderRouteSet(
      input.modality,
      selection.modelKey,
    );
    const routes = routeSet.routes.map((route) =>
      buildObservedRoute({
        provider: route.provider,
        modelId: route.modelId,
        modelKey: route.modelKey,
        variantSubKind: "official",
      }),
    );
    result = await executeTaskProviderInvocation({
      taskId,
      invocation,
      modality: input.modality,
      logicalCapabilityId: routeSet.logicalCapabilityId,
      primaryModelKey: routeSet.primaryModelKey,
      routes,
    });
  }

  if (
    (input.modality !== "music" &&
      input.modality !== "sound") ||
    !result.async
  )
    return result;
  const externalId = result.externalId?.trim();
  if (!externalId)
    throw new Error(
      `ASYNC_${input.modality.toUpperCase()}_EXTERNAL_ID_MISSING`,
    );
  try {
    const completed = await wrapMediaProviderExecution(
      {
        provider: selection.provider,
        modelKey: selection.modelKey,
        modality: input.modality,
        phase: "async_wait",
        requestSummary: () => ({ externalId }),
      },
      () =>
        waitForAsyncProviderResult({
          externalId,
          userId: input.userId,
          beforePoll: wait?.beforePoll,
          onPending: wait?.onPending,
        }),
      (finished) => ({ hasUrl: Boolean(finished.url) }),
    );
    return {
      ...result,
      async: false,
      audioUrl: completed.url,
    };
  } catch (error) {
    if (error instanceof ProviderQueueTimeoutError) {
      const queueError = new AppError(
        "GENERATION_QUEUE_TIMEOUT",
        error.message,
        {
          provider: selection.provider,
          details: {
            externalId,
            queuedMs: error.queuedMs,
            queueTimeoutMs: error.queueTimeoutMs,
          },
          cause: error,
        },
      );
      // 顺序契约（PG-06A 排队超时补偿）：先持久化“旧 external id 作废”
      // （checkpoint submitted → replay_authorized），再尽力取消 provider 侧任务；
      // 新提交只能由下一 attempt 经 durable fence 重新授权。此处崩溃最坏留下
      // 一个已被作废、无人消费的孤儿 provider job，不会出现双活身份。
      if (taskId && invocation) {
        await markTaskProviderInvocationReplayAuthorized({
          taskId,
          invocation,
          error: queueError,
        });
        const replayAuthorized = new AppError(
          "GENERATION_QUEUE_TIMEOUT",
          error.message,
          {
            provider: selection.provider,
            details: {
              externalId,
              queuedMs: error.queuedMs,
              queueTimeoutMs: error.queueTimeoutMs,
            },
            operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT_REPLAY_AUTHORIZED,
            cause: queueError,
          },
        );
        await cancelAsyncProviderTaskBestEffort({
          externalId,
          userId: input.userId,
        });
        throw replayAuthorized;
      }
      await cancelAsyncProviderTaskBestEffort({
        externalId,
        userId: input.userId,
      });
      throw queueError;
    }
    if (error instanceof ProviderTaskFailureError) {
      throw AppError.fromFailure(error.failure, error);
    }
    throw error;
  }
}

export async function generateImage(
  userId: string,
  modelKey: string,
  prompt: string,
  options?: AiImageExecutionOptions,
  invocation?: TaskProviderInvocation,
): Promise<GenerateResult> {
  return await executeMediaGeneration(
    {
      modality: "image",
      userId,
      modelKey,
      prompt,
      options,
    },
    invocation,
  );
}

export async function generateVideo(
  userId: string,
  modelKey: string,
  imageUrl: string,
  options?: AiVideoExecutionOptions,
  invocation?: TaskProviderInvocation,
): Promise<GenerateResult> {
  return await executeMediaGeneration(
    {
      modality: "video",
      userId,
      modelKey,
      imageUrl,
      options,
    },
    invocation,
  );
}

export async function generateMusic(
  userId: string,
  modelKey: string,
  generation:
    | { readonly kind: "prompt"; readonly prompt: string }
    | {
        readonly kind: "composition_plan";
        readonly compositionPlan: MusicCompositionPlan;
      },
  options?: AiMusicExecutionOptions,
  invocation?: TaskProviderInvocation,
  wait?: AsyncProviderWaitCallbacks,
): Promise<GenerateResult> {
  return await executeMediaGeneration(
    {
      modality: "music",
      userId,
      modelKey,
      generation,
      options,
    },
    invocation,
    wait,
  );
}
export async function generateSound(
  userId: string,
  modelKey: string,
  prompt: string,
  options?: AiSoundExecutionOptions,
  invocation?: TaskProviderInvocation,
  wait?: AsyncProviderWaitCallbacks,
): Promise<GenerateResult> {
  return await executeMediaGeneration(
    {
      modality: "sound",
      userId,
      modelKey,
      prompt,
      options,
    },
    invocation,
    wait,
  );
}
