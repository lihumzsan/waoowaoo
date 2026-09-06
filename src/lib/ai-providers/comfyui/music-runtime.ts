import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { AiProviderMusicExecutionContext, AiProviderPreparedMediaExecution, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { COMFYUI_RUNTIME_TARGET_IDS, resolveComfyUiRuntimeTarget, type ComfyUiRuntimeTarget } from './config'
import { formatComfyUiExternalId } from './external-id'
import { COMFYUI_MUSIC_OUTPUT_NODE_ID, resolveComfyUiMusicProfile, type ComfyUiMusicDurationPlan, type ComfyUiMusicProfile } from './music-profiles'
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
} from './transport'

function promptRejection(error: ComfyUiHttpError): ProviderSubmissionError {
  return new ProviderSubmissionError('PROVIDER_SUBMISSION_REJECTED', readComfyUiHttpError(error.payload), {
    disposition: 'rejected', provider: 'comfyui', externalId: null,
    details: { httpStatus: error.status, payload: error.payload }, cause: error,
  })
}

async function preflightMusicProfile(baseUrl: string, profile: ComfyUiMusicProfile, graph: ComfyUiPromptGraph): Promise<void> {
  const output = graph[COMFYUI_MUSIC_OUTPUT_NODE_ID]
  if (profile.outputNodeId !== COMFYUI_MUSIC_OUTPUT_NODE_ID || output?.class_type !== 'SaveAudioAdvanced'
    || output.inputs.format !== 'mp3' || output.inputs['format.quality'] !== 'V0') {
    throw new Error(`COMFYUI_MUSIC_OUTPUT_CONTRACT_INVALID:${profile.modelId}`)
  }
  const requirements = deriveComfyUiProfileRequirements({ profileId: profile.modelId, graph })
  const infoByClassName = new Map<string, unknown>()
  for (const className of requirements.nodeClasses) {
    const info = await requestComfyUiJson(baseUrl, `/object_info/${encodeURIComponent(className)}`)
    if (!asComfyUiRecord(info)?.[className]) throw new Error(`COMFYUI_NODE_MISSING:${className}`)
    infoByClassName.set(className, info)
  }
  for (const option of requirements.options) {
    if (!readComfyUiOptions(infoByClassName.get(option.classType), option.classType, option.inputName, option.location).includes(option.value)) {
      throw new Error(`COMFYUI_MODEL_MISSING:${option.value}`)
    }
  }
  assertComfyUiPromptGraphRuntimeContract({
    graph, infoByClassName,
    createOptionMismatchError: (option) => new Error(`COMFYUI_OPTION_MISSING:${option.className}:${option.inputName}:${option.value}`),
  })
}

type PreparedComfyUiMusicPrompt = {
  readonly promptId: string
  readonly target: ComfyUiRuntimeTarget
  readonly modelId: string
  readonly promptBody: string
  readonly durationPlan: ComfyUiMusicDurationPlan
}

export async function prepareComfyUiMusicGeneration(input: AiProviderMusicExecutionContext): Promise<AiProviderPreparedMediaExecution> {
  const profile = resolveComfyUiMusicProfile(input.selection)
  if (input.generation.kind !== 'prompt') throw new Error('COMFYUI_MUSIC_GENERATION_MODE_INVALID')
  const target = resolveComfyUiRuntimeTarget(profile.runtimeTargetId)
  const promptId = crypto.randomUUID()
  const built = profile.buildGraph({
    prompt: input.generation.prompt, options: input.options ?? {},
    seed: Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16),
  })
  await preflightMusicProfile(target.baseUrl, profile, built.graph)
  const prepared: PreparedComfyUiMusicPrompt = Object.freeze({
    promptId, target: Object.freeze(target), modelId: profile.modelId,
    promptBody: JSON.stringify({ prompt: built.graph, prompt_id: promptId }),
    durationPlan: Object.freeze(built.durationPlan),
  })
  return {
    execute: () => executeComfyUiMusicGeneration(prepared),
    cleanup: async () => {},
  }
}

export async function executeComfyUiMusicGeneration(prepared: PreparedComfyUiMusicPrompt): Promise<GenerateResult> {
  const { promptId, target, modelId, promptBody, durationPlan } = prepared
  const acceptedResult: GenerateResult = {
    success: true, async: true, requestId: promptId,
    externalId: formatComfyUiExternalId({ targetId: target.id, type: 'MUSIC', requestId: promptId }),
    endpoint: modelId, metadata: durationPlan,
  }
  try {
    const raw = await requestComfyUiJson(target.baseUrl, '/prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: promptBody,
    })
    if (readComfyUiString(asComfyUiRecord(raw)?.prompt_id) !== promptId) throw new Error('COMFYUI_PROMPT_ID_MISMATCH')
    return acceptedResult
  } catch (error) {
    if (error instanceof ComfyUiHttpError && error.status >= 400 && error.status < 500) throw promptRejection(error)
    try {
      const probe = asComfyUiRecord(await requestComfyUiJson(target.baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
      if (COMFYUI_ACCEPTED_JOB_STATUSES.has(readComfyUiString(probe?.status))) return acceptedResult
    } catch { /* Preserve the original accepted/unknown boundary below. */ }
    throw new Error(`COMFYUI_SUBMIT_OUTCOME_UNKNOWN:${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

export type ComfyUiMusicPollResult =
  | { status: 'pending'; pendingPhase: 'queued' | 'running' }
  | { status: 'completed'; audioUrl: string }
  | { status: 'failed'; failure: ReturnType<typeof createProviderAsyncTaskFailure> }

function resolveMusicRuntimeTarget(targetId: string | undefined): ComfyUiRuntimeTarget {
  const registeredId = COMFYUI_RUNTIME_TARGET_IDS.find((candidate) => candidate === targetId)
  if (!registeredId) throw new Error(`COMFYUI_RUNTIME_TARGET_INVALID:${targetId}`)
  return resolveComfyUiRuntimeTarget(registeredId)
}

export async function pollComfyUiMusic(promptId: string, targetId: string | undefined): Promise<ComfyUiMusicPollResult> {
  const { baseUrl } = resolveMusicRuntimeTarget(targetId)
  const record = asComfyUiRecord(await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}`))
  const status = readComfyUiString(record?.status)
  if (status === 'pending') return { status: 'pending', pendingPhase: 'queued' }
  if (status === 'in_progress') return { status: 'pending', pendingPhase: 'running' }
  if (status === 'cancelled') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: 'ComfyUI music job was cancelled', cause: record }) }
  if (status === 'failed') return { status: 'failed', failure: createProviderAsyncTaskFailure({ provider: 'comfyui', code: 'GENERATION_FAILED', message: readComfyUiHttpError(record?.execution_error), cause: record }) }
  if (status !== 'completed') throw new Error(`COMFYUI_JOB_STATUS_UNKNOWN:${status || '<missing>'}`)
  const output = readComfyUiDeclaredNodeAudioOutput(record?.outputs ?? record?.preview_output ?? record?.output, COMFYUI_MUSIC_OUTPUT_NODE_ID)
  if (!output) throw new Error('COMFYUI_MUSIC_AUDIO_OUTPUT_MISSING')
  return {
    status: 'completed',
    audioUrl: await readComfyUiOutputData({ baseUrl, output, contentType: 'audio/mpeg', maxBytes: 100 * 1024 * 1024, label: 'ComfyUI music' }),
  }
}

export async function cancelComfyUiMusic(promptId: string, targetId: string | undefined): Promise<void> {
  const { baseUrl } = resolveMusicRuntimeTarget(targetId)
  try {
    await requestComfyUiJson(baseUrl, `/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: 'POST' })
  } catch (error) {
    if (error instanceof ComfyUiHttpError && (error.status === 400 || error.status === 404)) return
    throw error
  }
}
