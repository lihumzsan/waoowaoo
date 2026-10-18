import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderPreparedMediaExecution, GenerateResult } from '@/lib/ai-providers/runtime-types'
import type { AsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { resolveComfyUiRuntimeTarget, type ComfyUiRuntimeTargetId } from './config'
import { formatComfyUiExternalId, type ComfyUiAsyncType } from './external-id'
import { COMFYUI_MUSIC_OUTPUT_NODE_ID, COMFYUI_MUSIC_PROFILES } from './music-profiles'
import { COMFYUI_VOICE_OUTPUT_NODE_ID, COMFYUI_VOICE_PROFILES } from './voice-profiles'
import { deriveComfyUiProfileRequirements } from './profile-requirements'
import { assertComfyUiPromptGraphRuntimeContract } from './prompt-graph-contract'
import type { ComfyUiPromptGraph } from './profiles'
import {
  asComfyUiRecord,
  COMFYUI_ACCEPTED_JOB_STATUSES,
  ComfyUiHttpError,
  readComfyUiDeclaredNodeAudioOutput,
  readComfyUiHttpError,
  readComfyUiOutputData,
  readComfyUiOptions,
  readComfyUiString,
  requestComfyUiJson,
  type ComfyUiAudioFormat,
} from './transport'

type ComfyUiAudioType = Exclude<ComfyUiAsyncType, 'VIDEO'>

type ComfyUiAudioRuntime = {
  readonly profiles: readonly {
    readonly runtimeTargetId: ComfyUiRuntimeTargetId
    readonly outputNodeId: string
  }[]
  readonly outputNodeId: string
  readonly format: ComfyUiAudioFormat
}

export const COMFYUI_AUDIO_RUNTIMES = {
  MUSIC: {
    profiles: COMFYUI_MUSIC_PROFILES,
    outputNodeId: COMFYUI_MUSIC_OUTPUT_NODE_ID,
    format: 'mp3',
  },
  VOICE: {
    profiles: COMFYUI_VOICE_PROFILES,
    outputNodeId: COMFYUI_VOICE_OUTPUT_NODE_ID,
    format: 'wav',
  },
} satisfies Record<ComfyUiAudioType, ComfyUiAudioRuntime>

function resolveAudioRuntimeTarget(type: ComfyUiAudioType, targetId: string | undefined) {
  const profile = COMFYUI_AUDIO_RUNTIMES[type].profiles.find((candidate) => candidate.runtimeTargetId === targetId)
  if (!profile) throw new Error(`COMFYUI_${type}_RUNTIME_TARGET_INVALID:${targetId}`)
  return resolveComfyUiRuntimeTarget(profile.runtimeTargetId)
}

function readPromptValidationRejection(error: unknown): string | null {
  if (!(error instanceof ComfyUiHttpError) || error.status !== 400) return null
  const payload = asComfyUiRecord(error.payload)
  const rejection = asComfyUiRecord(payload?.error)
  // Comfy-Org/ComfyUI server.py post_prompt + execution.py validate_prompt,
  // e8665ca8e4089ab917567cdb491308e1397663d4: these responses precede queue.put.
  if (!asComfyUiRecord(payload?.node_errors) || payload?.prompt_id !== undefined
    || !['invalid_prompt_id', 'no_prompt', 'missing_node_type', 'prompt_no_outputs', 'prompt_outputs_failed_validation']
      .includes(readComfyUiString(rejection?.type))
    || typeof rejection?.details !== 'string' || !asComfyUiRecord(rejection?.extra_info)) return null
  return readComfyUiString(rejection?.message) || null
}

async function preflightAudioGraph(input: {
  readonly baseUrl: string
  readonly modelId: string
  readonly graph: ComfyUiPromptGraph
  readonly outputNodeId: string
}): Promise<void> {
  const requirements = deriveComfyUiProfileRequirements({ profileId: input.modelId, graph: input.graph })
  const infoByClassName = new Map<string, unknown>()
  for (const className of requirements.nodeClasses) {
    const info = await requestComfyUiJson(input.baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!asComfyUiRecord(info)?.[className]) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
    infoByClassName.set(className, info)
  }
  for (const option of requirements.options) {
    if (!readComfyUiOptions(infoByClassName.get(option.classType), option.classType, option.inputName, option.location).includes(option.value)) {
      throw new Error(`COMFYUI_MODEL_MISSING:${option.value}`)
    }
  }
  assertComfyUiPromptGraphRuntimeContract({
    graph: input.graph, infoByClassName,
    createOptionMismatchError: (option) => new Error(`COMFYUI_OPTION_MISSING:${option.className}:${option.inputName}:${option.value}`),
  })
  const outputClass = input.graph[input.outputNodeId]?.class_type
  const outputInfo = outputClass && asComfyUiRecord(asComfyUiRecord(infoByClassName.get(outputClass))?.[outputClass])
  if (!outputInfo || outputInfo.output_node !== true) {
    throw new Error(`COMFYUI_AUDIO_OUTPUT_NODE_INVALID:${input.outputNodeId}`)
  }
}

export async function prepareComfyUiAudioPrompt(input: {
  readonly type: ComfyUiAudioType
  readonly modelId: string
  readonly targetId: ComfyUiRuntimeTargetId
  readonly promptId: string
  readonly graph: ComfyUiPromptGraph
  readonly metadata?: Readonly<Record<string, unknown>>
}): Promise<AiProviderPreparedMediaExecution> {
  const target = resolveAudioRuntimeTarget(input.type, input.targetId)
  const runtime = COMFYUI_AUDIO_RUNTIMES[input.type]
  await preflightAudioGraph({ baseUrl: target.baseUrl, modelId: input.modelId, graph: input.graph, outputNodeId: runtime.outputNodeId })
  const { promptId } = input
  const promptBody = JSON.stringify({ prompt: input.graph, prompt_id: promptId })
  const acceptedResult: GenerateResult = Object.freeze({
    success: true, async: true, requestId: promptId,
    externalId: formatComfyUiExternalId({ targetId: target.id, type: input.type, requestId: promptId }),
    endpoint: input.modelId,
    ...(input.metadata ? { metadata: Object.freeze({ ...input.metadata }) } : {}),
  })
  return {
    execute: async () => {
      try {
        const raw = await requestComfyUiJson(target.baseUrl, '/prompt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: promptBody,
        })
        if (readComfyUiString(asComfyUiRecord(raw)?.prompt_id) !== promptId) throw new Error('COMFYUI_PROMPT_ID_MISMATCH')
        return acceptedResult
      } catch (error) {
        const rejection = readPromptValidationRejection(error)
        if (rejection && error instanceof ComfyUiHttpError) {
          throw new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', rejection, {
            disposition: 'rejected', provider: 'comfyui', externalId: null,
            details: { httpStatus: error.status, payload: error.payload }, cause: error,
          })
        }
        try {
          const probe = asComfyUiRecord(await requestComfyUiJson(target.baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
          if (COMFYUI_ACCEPTED_JOB_STATUSES.has(readComfyUiString(probe?.status))) return acceptedResult
        } catch { /* Preserve the original accepted/unknown boundary below. */ }
        throw new Error(`COMFYUI_SUBMIT_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
    },
    cleanup: async () => {},
  }
}

export async function pollComfyUiAudio(type: ComfyUiAudioType, promptId: string, targetId: string | undefined): Promise<AsyncPollResult> {
  const { baseUrl } = resolveAudioRuntimeTarget(type, targetId)
  const runtime = COMFYUI_AUDIO_RUNTIMES[type]
  const record = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
  const status = readComfyUiString(record?.status)
  if (status === 'pending') return { status: 'pending', pendingPhase: 'queued' }
  if (status === 'in_progress') return { status: 'pending', pendingPhase: 'running' }
  if (status === 'cancelled') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: `ComfyUI ${type.toLowerCase()} job was cancelled`, cause: record }) }
  if (status === 'failed') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: readComfyUiHttpError(record?.execution_error), cause: record }) }
  if (status !== 'completed') throw new Error(`COMFYUI_JOB_STATUS_UNKNOWN:${status || '<missing>'}`)
  const output = readComfyUiDeclaredNodeAudioOutput(record?.outputs ?? record?.preview_output ?? record?.output, runtime.outputNodeId, runtime.format)
  if (!output) throw new Error(`COMFYUI_${type}_AUDIO_OUTPUT_MISSING`)
  return {
    status: 'completed',
    resultUrl: await readComfyUiOutputData({
      baseUrl, output, format: runtime.format,
      maxBytes: 100 * 1024 * 1024, label: `ComfyUI ${type.toLowerCase()}`,
    }),
  }
}

export async function cancelComfyUiAudio(type: ComfyUiAudioType, promptId: string, targetId: string | undefined): Promise<void> {
  const { baseUrl } = resolveAudioRuntimeTarget(type, targetId)
  try {
    await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: 'POST' })
  } catch (error) {
    if (error instanceof ComfyUiHttpError && (error.status === 400 || error.status === 404)) {
      const job = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
      if (['completed', 'failed', 'cancelled'].includes(readComfyUiString(job?.status))) return
    }
    throw error
  }
}
