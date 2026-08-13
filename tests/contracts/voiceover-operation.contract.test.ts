import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { isPlannedOperation } from '@/lib/operations/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { preflightMediaGenerationOptions, preflightMediaProviderRoutes } from '@/lib/ai-exec/media-preflight'
import { PLATFORM_VOICEOVER_MODEL_KEY } from '@/lib/ai-registry/platform-models'
import { prisma } from '@/lib/prisma'
import { parseWorkspaceResourceVoiceoverMixTaskPayload } from '@/lib/workspace-resource/voiceover-contract'
import { TASK_TYPE } from '@/lib/task/types'

const USER_ID = 'voiceover-user'
const PROJECT_ID = 'voiceover-project'
const SOURCE_ID = 'source-video'
const REFERENCE_ID = 'reference-audio'
const BGM_ID = 'background-music'

const context: ProjectAgentOperationContext = {
  request: null,
  requestId: 'voiceover-request',
  userId: USER_ID,
  projectId: PROJECT_ID,
  context: { locale: 'zh', turnId: 'voiceover-turn' },
  source: 'project-ui/api',
}

const validInput = {
  name: '旁白视频',
  video: { resourceId: SOURCE_ID, contentVersion: 3 },
  referenceAudio: { resourceId: REFERENCE_ID, contentVersion: 2 },
  voiceovers: [
    { name: '第一段', text: '第一段旁白', language: 'zh' as const, startSeconds: 0 },
    { name: '第二段', text: 'Second narration', language: 'en' as const, startSeconds: 4.25 },
  ],
  music: { resourceId: BGM_ID, contentVersion: 5 },
}

function installPlannerStorageBoundary(input: {
  bgmDurationMs: number | null
  referenceDurationMs?: number
  referenceStorageKey?: string
  referenceMimeType?: string | null
  referenceSizeBytes?: bigint | null
}) {
  vi.spyOn(prisma.project, 'findFirst').mockResolvedValue({ id: PROJECT_ID } as never)
  vi.spyOn(prisma.workspaceResource, 'findFirst').mockResolvedValue(null)
  vi.spyOn(prisma.workspaceResource, 'findMany').mockResolvedValue([
    { id: SOURCE_ID, workspacePath: 'video/source.mp4', currentVersion: 3, status: 'ready' },
    { id: REFERENCE_ID, workspacePath: 'audio/reference.mp3', currentVersion: 2, status: 'ready' },
    { id: BGM_ID, workspacePath: 'audio/bgm.mp3', currentVersion: 5, status: 'ready' },
  ] as never)
  vi.spyOn(prisma.workspaceResourceVersion, 'findUnique').mockResolvedValue({ id: 'frozen-version' } as never)
  vi.spyOn(prisma.workspaceResourceVersion, 'findMany').mockResolvedValue([
    {
      resourceId: SOURCE_ID,
      version: 3,
      contentKind: 'media',
      resource: { userId: USER_ID, projectId: PROJECT_ID, resourceKind: 'file', mediaType: 'video' },
      media: { id: 'source-media', storageKey: 'media/source.mp4', mimeType: 'video/mp4', width: 1920, height: 1080, durationMs: 12_000, sizeBytes: BigInt(1_000_000) },
    },
    {
      resourceId: REFERENCE_ID,
      version: 2,
      contentKind: 'media',
      resource: { userId: USER_ID, projectId: PROJECT_ID, resourceKind: 'file', mediaType: 'audio' },
      media: { id: 'reference-media', storageKey: input.referenceStorageKey ?? 'media/reference.mp3', mimeType: input.referenceMimeType === undefined ? 'audio/mpeg' : input.referenceMimeType, width: null, height: null, durationMs: input.referenceDurationMs ?? 5_000, sizeBytes: input.referenceSizeBytes === undefined ? BigInt(1_000_000) : input.referenceSizeBytes },
    },
    {
      resourceId: BGM_ID,
      version: 5,
      contentKind: 'media',
      resource: { userId: USER_ID, projectId: PROJECT_ID, resourceKind: 'file', mediaType: 'audio' },
      media: { id: 'bgm-media', storageKey: 'media/bgm.mp3', mimeType: 'audio/ogg', width: null, height: null, durationMs: input.bgmDurationMs, sizeBytes: BigInt(80_000_000) },
    },
  ] as never)
}

function plannedVoiceoverOperation() {
  const operation = createProjectAgentOperationRegistryForApi().produce_voiceover_video
  if (!operation || !isPlannedOperation(operation)) throw new Error('voiceover operation must be planned')
  return operation
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('produce_voiceover_video operation contract', () => {
  it('is registered as the single planned voiceover entry point', () => {
    const operation = createProjectAgentOperationRegistryForApi().produce_voiceover_video
    expect(operation).toBeDefined()
    expect(operation?.id).toBe('produce_voiceover_video')
    expect(isPlannedOperation(operation!)).toBe(true)
    if (!isPlannedOperation(operation!)) throw new Error('voiceover operation must be planned')
    expect(operation.planContractRevision).toBe('produce_voiceover_video/v2')
    expect(operation.resourceContract.kind).toBe('resource')
    if (operation.resourceContract.kind !== 'resource') throw new Error('voiceover resource contract missing')
    expect(operation.resourceContract.outputMediaTypes).toEqual(['audio', 'video'])
  })

  it('rejects a request without frozen Resource versions', () => {
    const operation = createProjectAgentOperationRegistryForApi().produce_voiceover_video
    expect(operation?.inputSchema.safeParse({
      name: '旁白视频',
      video: { resourceId: 'video' },
      referenceAudio: { resourceId: 'reference' },
      voiceovers: [{ name: '第一段', text: '你好', language: 'zh', startSeconds: 0 }],
    }).success).toBe(false)
  })

  it('production preflight accepts the exact MOSS voice Worker options and rejects an invalid canonical language', async () => {
    vi.stubEnv('COMFYUI_BASE_URL', 'http://127.0.0.1:8878')
    const options = {
      language: 'zh',
      referenceAudio: 'media/reference.mp3',
      referenceAudioDurationMs: 5_000,
      outputFormat: 'mp3',
    }
    const preflight = await preflightMediaGenerationOptions({
      userId: USER_ID,
      modelKey: PLATFORM_VOICEOVER_MODEL_KEY,
      modality: 'voice',
      prompt: '第一段旁白',
      options,
    })
    expect(preflight.options).toEqual(options)
    expect(() => preflightMediaProviderRoutes({
      selection: preflight.selection,
      modality: 'voice',
      prompt: '第一段旁白',
      options: preflight.options,
    })).not.toThrow()

    await expect(preflightMediaGenerationOptions({
      userId: USER_ID,
      modelKey: PLATFORM_VOICEOVER_MODEL_KEY,
      modality: 'voice',
      prompt: '第一段旁白',
      options: { ...options, language: 'fr' },
    })).rejects.toMatchObject({ field: 'language' })
  })

  it('rejects unavailable provider configuration before returning planned Tasks or identities', async () => {
    installPlannerStorageBoundary({ bgmDurationMs: 60_000 })
    vi.stubEnv('COMFYUI_BASE_URL', '')
    const operation = plannedVoiceoverOperation()
    const input = operation.inputSchema.safeParse(validInput)
    if (!input.success) throw new Error('valid voiceover input fixture must parse')

    await expect(operation.plan(context, input.data)).rejects.toThrow('COMFYUI_BASE_URL_MISSING')
  })

  it('rejects optional BGM without a positive authoritative duration', async () => {
    installPlannerStorageBoundary({ bgmDurationMs: 0 })
    vi.stubEnv('COMFYUI_BASE_URL', 'http://127.0.0.1:8878')
    const operation = plannedVoiceoverOperation()
    const input = operation.inputSchema.safeParse(validInput)
    if (!input.success) throw new Error('valid voiceover input fixture must parse')

    await expect(operation.plan(context, input.data)).rejects.toThrow('VOICEOVER_BGM_AUDIO_DURATION_INVALID')
  })

  it.each([
    [{ referenceMimeType: 'audio/ogg', referenceSizeBytes: BigInt(1_000_000) }, 'COMFYUI_MOSS_TTS_REFERENCE_AUDIO_MIME_TYPE_UNSUPPORTED'],
    [{ referenceMimeType: 'audio/mpeg', referenceSizeBytes: BigInt(15 * 1024 * 1024 + 1) }, 'COMFYUI_MOSS_TTS_REFERENCE_AUDIO_TOO_LARGE'],
    [{ referenceMimeType: null, referenceSizeBytes: BigInt(1_000_000) }, 'COMFYUI_MOSS_TTS_REFERENCE_AUDIO_MIME_TYPE_MISSING'],
    [{ referenceMimeType: 'audio/mpeg', referenceSizeBytes: null }, 'COMFYUI_MOSS_TTS_REFERENCE_AUDIO_SIZE_BYTES_MISSING'],
  ])('rejects invalid frozen MOSS reference metadata before returning a plan %#', async (reference, error) => {
    installPlannerStorageBoundary({ bgmDurationMs: 60_000, ...reference })
    vi.stubEnv('COMFYUI_BASE_URL', 'http://127.0.0.1:8878')
    const operation = plannedVoiceoverOperation()
    const input = operation.inputSchema.safeParse(validInput)
    if (!input.success) throw new Error('valid voiceover input fixture must parse')

    await expect(operation.plan(context, input.data)).rejects.toThrow(error)
  })

  it('accepts a supported reference alias without applying the MOSS policy to BGM', async () => {
    installPlannerStorageBoundary({
      bgmDurationMs: 60_000,
      referenceMimeType: 'audio/mp3',
      referenceSizeBytes: BigInt(15 * 1024 * 1024),
    })
    vi.stubEnv('COMFYUI_BASE_URL', 'http://127.0.0.1:8878')
    const operation = plannedVoiceoverOperation()
    const input = operation.inputSchema.safeParse(validInput)
    if (!input.success) throw new Error('valid voiceover input fixture must parse')

    await expect(operation.plan(context, input.data)).resolves.toMatchObject({
      operationId: 'produce_voiceover_video',
    })
  })

  it('freezes normalized Worker options and one exhaustive mix aggregate in the returned plan', async () => {
    installPlannerStorageBoundary({ bgmDurationMs: 60_000 })
    vi.stubEnv('COMFYUI_BASE_URL', 'http://127.0.0.1:8878')
    const operation = plannedVoiceoverOperation()
    const input = operation.inputSchema.safeParse(validInput)
    if (!input.success) throw new Error('valid voiceover input fixture must parse')

    const plan = await operation.plan(context, input.data)
    const narrationTasks = plan.tasks.filter((task) => task.taskType === TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER)
    expect(narrationTasks.map((task) => task.payload.generationOptions)).toEqual([
      { language: 'zh', referenceAudio: 'media/reference.mp3', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' },
      { language: 'en', referenceAudio: 'media/reference.mp3', referenceAudioDurationMs: 5_000, outputFormat: 'mp3' },
    ])
    const mixTask = plan.tasks.find((task) => task.taskType === TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER_MIX)
    if (!mixTask) throw new Error('voiceover mix Task missing')
    expect(mixTask.payload.resource).toMatchObject({ modelKey: null })
    const aggregate = parseWorkspaceResourceVoiceoverMixTaskPayload(mixTask.payload).inputAggregate
    expect(aggregate).toMatchObject({
      source: { resourceId: SOURCE_ID, contentVersion: 3, workspacePath: 'video/source.mp4', role: 'source_video', position: 0 },
      reference: { resourceId: REFERENCE_ID, contentVersion: 2, workspacePath: 'audio/reference.mp3', role: 'reference_audio', position: 0 },
      narrations: [
        { resourceId: plan.tasks[0]!.target.targetId, contentVersion: 1, workspacePath: '第一段-01', role: 'voiceover_audio', position: 0, startSeconds: 0 },
        { resourceId: plan.tasks[1]!.target.targetId, contentVersion: 1, workspacePath: '第二段-02', role: 'voiceover_audio', position: 1, startSeconds: 4.25 },
      ],
      bgm: { resourceId: BGM_ID, contentVersion: 5, workspacePath: 'audio/bgm.mp3', role: 'bgm_audio', position: 0 },
    })
  })

  it.each([
    ['reference storage key', { referenceStorageKey: 'media/reference-v2.mp3', referenceDurationMs: 5_000 }],
    ['reference duration', { referenceStorageKey: 'media/reference.mp3', referenceDurationMs: 6_000 }],
  ])('changes narration identity when normalized %s changes', async (_label, variant) => {
    vi.stubEnv('COMFYUI_BASE_URL', 'http://127.0.0.1:8878')
    installPlannerStorageBoundary({ bgmDurationMs: 60_000 })
    const operation = plannedVoiceoverOperation()
    const input = operation.inputSchema.safeParse(validInput)
    if (!input.success) throw new Error('valid voiceover input fixture must parse')
    const baseline = await operation.plan(context, input.data)
    const baselineTask = baseline.tasks.find((task) => task.taskType === TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER)
    const baselineMixTask = baseline.tasks.find((task) => task.taskType === TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER_MIX)
    if (!baselineTask) throw new Error('baseline narration Task missing')
    if (!baselineMixTask) throw new Error('baseline mix Task missing')

    vi.restoreAllMocks()
    installPlannerStorageBoundary({ bgmDurationMs: 60_000, ...variant })
    const changed = await operation.plan(context, input.data)
    const changedTask = changed.tasks.find((task) => task.taskType === TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER)
    const changedMixTask = changed.tasks.find((task) => task.taskType === TASK_TYPE.WORKSPACE_RESOURCE_VOICEOVER_MIX)
    if (!changedTask) throw new Error('changed narration Task missing')
    if (!changedMixTask) throw new Error('changed mix Task missing')

    expect(changedTask.payload.resource).toMatchObject({ inputHash: expect.any(String) })
    expect((changedTask.payload.resource as { inputHash: string }).inputHash).not.toBe(
      (baselineTask.payload.resource as { inputHash: string }).inputHash,
    )
    expect(changedTask.dedupeKey).not.toBe(baselineTask.dedupeKey)
    expect((changedMixTask.payload.resource as { inputHash: string }).inputHash).not.toBe(
      (baselineMixTask.payload.resource as { inputHash: string }).inputHash,
    )
    expect(changedMixTask.dedupeKey).not.toBe(baselineMixTask.dedupeKey)
  })
})
