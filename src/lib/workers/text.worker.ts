import { Worker, type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { withInternalLLMStreamCallbacks, type InternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { LLMStreamKind } from '@/lib/llm-observe/types'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { buildAiPrompt as buildPrompt, AI_PROMPT_IDS as PROMPT_IDS } from '@/lib/ai-prompts'
import { resolveInsertPanelUserInput } from '@/lib/project-workflow/insert-panel'
import { buildInsertPanelLocationsDescription } from '@/lib/project-workflow/insert-panel-prompt-context'
import { getProjectModelConfig } from '@/lib/config-service'
import { reportTaskProgress, reportTaskStreamChunk, withTaskLifecycle } from './shared'
import { assertTaskActive } from './utils'
import { handleAssetHubAIDesignTask } from './handlers/asset-hub-ai-design'
import { handleEpisodeSplitTask } from './handlers/episode-split'
import { handleAssetHubAIModifyTask } from './handlers/asset-hub-ai-modify'
import { handleReferenceToCharacterTask } from './handlers/reference-to-character'
import { handleShotAITask } from './handlers/shot-ai-tasks'
import { handleEditScriptGenerateTask } from './handlers/edit-script-generate'
import {
  handleEditScreenplayGenerateTask,
  handleEditScreenplayReviseTask,
} from './handlers/edit-screenplay-generate'
import {
  handleEditCinematographyShotPlanGenerateTask,
  handleEditDirectorDecoupageGenerateTask,
} from './handlers/edit-script-structured-generate'
import { handleEditStylePreviewsGenerateTask } from './handlers/edit-style-previews-generate'
import {
  handleEditScriptStoryboardCameraPlanTask,
  handleEditScriptStoryboardPrepareTask,
} from './handlers/edit-script-storyboard-consistency-task-handler'

function readAssetKind(value: Record<string, unknown>): string {
  return typeof value.assetKind === 'string' ? value.assetKind : 'location'
}

function readNullableText(value: Record<string, unknown>, key: string): string | null {
  const field = value[key]
  return typeof field === 'string' ? field : null
}

type AnyObj = Record<string, unknown>
type JsonRecord = Record<string, unknown>

type WorkerLLMStreamContext = {
  streamRunId: string
  nextSeqByStepLane: Record<string, number>
}

type WorkerInternalLLMStreamCallbacks = InternalLLMStreamCallbacks & {
  flush: () => Promise<void>
}

function createWorkerLLMStreamContext(job: Job<TaskJobData>, label = 'worker'): WorkerLLMStreamContext {
  return {
    streamRunId: `run:${job.data.taskId}:${label}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    nextSeqByStepLane: {},
  }
}

function nextWorkerStreamSeq(streamContext: WorkerLLMStreamContext, stepId: string | null, lane: string) {
  const key = `${stepId || '__default'}|${lane || 'main'}`
  const current = streamContext.nextSeqByStepLane[key] || 1
  streamContext.nextSeqByStepLane[key] = current + 1
  return current
}

function createWorkerLLMStreamCallbacks(
  job: Job<TaskJobData>,
  streamContext: WorkerLLMStreamContext,
): WorkerInternalLLMStreamCallbacks {
  const maxChunkChars = 128
  let publishQueue: Promise<void> = Promise.resolve()

  const enqueue = (work: () => Promise<void>) => {
    publishQueue = publishQueue
      .catch(() => undefined)
      .then(work)
  }

  return {
    onStage: ({ stage, provider, step }) => {
      const stageLabel =
        stage === 'submit'
          ? 'progress.runtime.stage.llmSubmit'
          : stage === 'streaming'
            ? 'progress.runtime.stage.llmStreaming'
            : stage === 'fallback'
              ? 'progress.runtime.stage.llmFallbackNonStream'
              : 'progress.runtime.stage.llmCompleted'
      const stageKey = `worker_llm_${stage}`
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      enqueue(async () => {
        await reportTaskProgress(job, 65, {
          stage: stageKey,
          stageLabel,
          displayMode: 'detail',
          message: stageLabel,
          streamRunId: streamContext.streamRunId,
          ...(stepId ? { stepId } : {}),
          ...(stepTitle ? { stepTitle } : {}),
          ...(stepIndex ? { stepIndex } : {}),
          ...(stepTotal ? { stepTotal } : {}),
          meta: {
            provider: provider || null,
          },
        })
      })
    },
    onChunk: ({ kind, delta, lane, step }) => {
      if (!delta) return
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      const laneKey = lane || (kind === 'reasoning' ? 'reasoning' : 'main')
      for (let i = 0; i < delta.length; i += maxChunkChars) {
        const piece = delta.slice(i, i + maxChunkChars)
        if (!piece) continue
        enqueue(async () => {
          await reportTaskStreamChunk(
            job,
            {
              kind: kind as LLMStreamKind,
              delta: piece,
              seq: nextWorkerStreamSeq(streamContext, stepId, laneKey),
              lane: laneKey,
            },
            {
              stage: 'worker_llm_stream',
              stageLabel: 'progress.runtime.stage.llmStreaming',
              displayMode: 'detail',
              done: false,
              message: kind === 'reasoning' ? 'progress.runtime.llm.reasoning' : 'progress.runtime.llm.output',
              streamRunId: streamContext.streamRunId,
              ...(stepId ? { stepId } : {}),
              ...(stepTitle ? { stepTitle } : {}),
              ...(stepIndex ? { stepIndex } : {}),
              ...(stepTotal ? { stepTotal } : {}),
            },
          )
        })
      }
    },
    onComplete: () => {
      enqueue(async () => {
        await reportTaskProgress(job, 90, {
          stage: 'worker_llm_complete',
          stageLabel: 'progress.runtime.stage.llmCompleted',
          displayMode: 'detail',
          message: 'progress.runtime.llm.completed',
          streamRunId: streamContext.streamRunId,
        })
      })
    },
    onError: (error) => {
      enqueue(async () => {
        await reportTaskProgress(job, 90, {
          stage: 'worker_llm_error',
          stageLabel: 'progress.runtime.stage.llmFailed',
          displayMode: 'detail',
          message: error instanceof Error ? error.message : String(error),
          streamRunId: streamContext.streamRunId,
        })
      })
    },
    async flush() {
      await publishQueue.catch(() => undefined)
    },
  }
}

function asJsonRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : null
}

function parseJsonObjectResponse(responseText: string): JsonRecord {
  let jsonText = responseText.trim()
  jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')

  const firstBrace = jsonText.indexOf('{')
  const lastBrace = jsonText.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('JSON format invalid')
  }

  const parsed = JSON.parse(jsonText.substring(firstBrace, lastBrace + 1))
  const record = asJsonRecord(parsed)
  if (!record) {
    throw new Error('JSON payload must be an object')
  }
  return record
}

function parsePanelCharacters(panel: { characters: string | null } | null | undefined): string[] {
  if (!panel?.characters) return []
  try {
    const raw = JSON.parse(panel.characters)
    if (!Array.isArray(raw)) return []
    return raw
      .map((item) =>
        typeof item === 'string'
          ? item
          : typeof item === 'object' && item !== null && typeof (item as JsonRecord).name === 'string'
            ? ((item as JsonRecord).name as string)
            : '',
      )
      .filter(Boolean)
  } catch {
    return []
  }
}

function parsePanelProps(panel: Record<string, unknown> | null | undefined): string[] {
  const rawValue = panel?.props
  if (typeof rawValue !== 'string' || !rawValue) return []
  try {
    const raw = JSON.parse(rawValue)
    if (!Array.isArray(raw)) return []
    return raw.map((item) => (typeof item === 'string' ? item : '')).filter(Boolean)
  } catch {
    return []
  }
}

async function handleInsertPanelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const storyboardId = typeof payload.storyboardId === 'string' ? payload.storyboardId : job.data.targetId
  const insertAfterPanelId = typeof payload.insertAfterPanelId === 'string' ? payload.insertAfterPanelId : ''
  const userInput = resolveInsertPanelUserInput(payload, job.data.locale)

  if (!storyboardId || !insertAfterPanelId) {
    throw new Error('insert_panel requires storyboardId/insertAfterPanelId')
  }

  const storyboard = await prisma.projectStoryboard.findUnique({
    where: { id: storyboardId },
    include: {
      panels: { orderBy: { panelIndex: 'asc' } },
    },
  })
  if (!storyboard) throw new Error('Storyboard not found')

  const prevPanel = storyboard.panels.find((panel) => panel.id === insertAfterPanelId)
  if (!prevPanel) throw new Error('insert_after panel not found')

  const nextPanel = storyboard.panels.find((panel) => panel.panelIndex === prevPanel.panelIndex + 1)
  const projectModels = await getProjectModelConfig(job.data.projectId, job.data.userId)
  const analysisModel = projectModels.analysisModel
  if (!analysisModel) throw new Error('Analysis model not configured')

  const projectData = await prisma.project.findUnique({
    where: { id: job.data.projectId },
    include: {
      characters: { include: { appearances: { orderBy: { appearanceIndex: 'asc' } } } },
      locations: { include: { images: { orderBy: { imageIndex: 'asc' } } } },
    },
  })
  if (!projectData) throw new Error('Project not found')
  const projectLocations = (projectData.locations || []).filter((item) => readAssetKind(item as unknown as Record<string, unknown>) !== 'prop')
  const projectProps = (projectData.locations || []).filter((item) => readAssetKind(item as unknown as Record<string, unknown>) === 'prop')

  const prevPanelJson = JSON.stringify(
    {
      shot_type: prevPanel.shotType,
      camera_move: prevPanel.cameraMove,
      description: prevPanel.description,
      video_prompt: prevPanel.videoPrompt,
      location: prevPanel.location,
      characters: prevPanel.characters ? JSON.parse(prevPanel.characters) : [],
      props: parsePanelProps(prevPanel),
      source_text: prevPanel.srtSegment,
    },
    null,
    2,
  )

  const nextPanelJson = nextPanel
    ? JSON.stringify(
      {
        shot_type: nextPanel.shotType,
        camera_move: nextPanel.cameraMove,
        description: nextPanel.description,
        video_prompt: nextPanel.videoPrompt,
        location: nextPanel.location,
        characters: nextPanel.characters ? JSON.parse(nextPanel.characters) : [],
        props: parsePanelProps(nextPanel),
        source_text: nextPanel.srtSegment,
      },
      null,
      2,
    )
    : '无'

  const relatedCharacters = Array.from(new Set([...parsePanelCharacters(prevPanel), ...parsePanelCharacters(nextPanel)]))
  const relatedLocations = Array.from(new Set([prevPanel.location, nextPanel?.location].filter((v): v is string => Boolean(v))))
  const relatedProps = Array.from(new Set([...parsePanelProps(prevPanel), ...parsePanelProps(nextPanel)]))

  const charactersFullDescription = (projectData.characters || [])
    .filter((character) => relatedCharacters.length === 0 || relatedCharacters.includes(character.name))
    .map((character) => {
      const appearances = character.appearances || []
      if (appearances.length === 0) return `${character.name}: 无形象信息`
      const appearanceText = appearances
        .map((appearance) => {
          const descriptions = appearance.descriptions ? (() => {
            try {
              const parsed = JSON.parse(appearance.descriptions)
              return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
            } catch {
              return [] as string[]
            }
          })() : []
          const selectedIndex = appearance.selectedIndex ?? 0
          const selectedDescription = descriptions[selectedIndex] || appearance.description || '无描述'
          return `${appearance.changeReason || '默认'}: ${selectedDescription}`
        })
        .join(' | ')
      return `${character.name}: ${appearanceText}`
    })
    .join('\n') || '无'

  const locationsDescription = buildInsertPanelLocationsDescription(
    projectLocations,
    relatedLocations,
    job.data.locale,
  )
  const propsDescription = projectProps
    .filter((prop) => relatedProps.length === 0 || relatedProps.includes(prop.name))
    .map((prop) => `${prop.name}: ${prop.summary || '无描述'}`)
    .join('\n') || '无'

  const prompt = buildPrompt({
    promptId: PROMPT_IDS.STORYBOARD_INSERT_PANEL,
    locale: job.data.locale,
    variables: {
      user_input: userInput,
      prev_panel_json: prevPanelJson,
      next_panel_json: nextPanelJson,
      characters_full_description: charactersFullDescription,
      locations_description: locationsDescription,
      props_description: propsDescription,
    },
  })

  await reportTaskProgress(job, 40, { stage: 'insert_panel_generate_text' })
  const insertPanelStreamContext = createWorkerLLMStreamContext(job, 'insert_panel')
  const insertPanelCallbacks = createWorkerLLMStreamCallbacks(job, insertPanelStreamContext)

  const completion = await withInternalLLMStreamCallbacks(
    insertPanelCallbacks,
    async () =>
      await executeAiTextStep({
        userId: job.data.userId,
        model: analysisModel,
        messages: [{ role: 'user', content: prompt }],
        reasoning: true,
        projectId: job.data.projectId,
        action: 'insert_panel',
        meta: {
          stepId: 'insert_panel',
          stepTitle: '插入分镜',
          stepIndex: 1,
          stepTotal: 1,
        },
      }),
  )
  await insertPanelCallbacks.flush()

  const responseText = completion.text
  if (!responseText) throw new Error('Insert panel completion empty')

  const generatedPanel = parseJsonObjectResponse(responseText)
  const generatedShotType = typeof generatedPanel.shot_type === 'string' ? generatedPanel.shot_type : null
  const generatedCameraMove = typeof generatedPanel.camera_move === 'string' ? generatedPanel.camera_move : null
  const generatedDescription = typeof generatedPanel.description === 'string' ? generatedPanel.description : null
  const generatedVideoPrompt = typeof generatedPanel.video_prompt === 'string' ? generatedPanel.video_prompt : null
  const generatedLocation = typeof generatedPanel.location === 'string' ? generatedPanel.location : null
  const generatedSrtSegment = typeof generatedPanel.source_text === 'string' ? generatedPanel.source_text : null
  const generatedDuration = typeof generatedPanel.duration === 'number' ? generatedPanel.duration : null

  await reportTaskProgress(job, 80, { stage: 'insert_panel_persist' })

  await assertTaskActive(job, 'insert_panel_transaction')
  const newPanel = await prisma.$transaction(async (tx) => {
    const panelModel = tx.projectPanel as unknown as {
      create: (args: { data: Record<string, unknown> }) => Promise<{ id: string; panelIndex: number }>
    }
    // Two-phase reindexing to avoid unique constraint collision on (storyboardId, panelIndex)
    // Phase A: shift affected panels to negative indices to clear the positive namespace
    const affectedPanels = await tx.projectPanel.findMany({
      where: { storyboardId, panelIndex: { gt: prevPanel.panelIndex } },
      select: { id: true, panelIndex: true },
      orderBy: { panelIndex: 'asc' },
    })
    for (const p of affectedPanels) {
      await tx.projectPanel.update({
        where: { id: p.id },
        data: { panelIndex: -(p.panelIndex + 1) },
      })
    }
    // Phase B: set affected panels to their final positive indices
    for (const p of affectedPanels) {
      await tx.projectPanel.update({
        where: { id: p.id },
        data: { panelIndex: p.panelIndex + 1 },
      })
    }

    const created = await panelModel.create({
      data: {
        storyboardId,
        panelIndex: prevPanel.panelIndex + 1,
        panelNumber: prevPanel.panelIndex + 2,
        shotType: generatedShotType || prevPanel.shotType,
        cameraMove: generatedCameraMove || prevPanel.cameraMove,
        description: generatedDescription || userInput,
        videoPrompt: generatedVideoPrompt || generatedDescription || userInput,
        location: generatedLocation || prevPanel.location,
        characters: generatedPanel.characters ? JSON.stringify(generatedPanel.characters) : prevPanel.characters,
        props: generatedPanel.props ? JSON.stringify(generatedPanel.props) : readNullableText(prevPanel as unknown as Record<string, unknown>, 'props'),
        srtSegment: generatedSrtSegment || prevPanel.srtSegment,
        duration: generatedDuration,
      },
    })

    await tx.projectStoryboard.update({
      where: { id: storyboardId },
      data: { panelCount: { increment: 1 }, updatedAt: new Date() },
    })

    return created
  })

  return {
    storyboardId,
    panelId: newPanel.id,
    panelIndex: newPanel.panelIndex,
  }
}

async function processTextTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE:
      return await handleEditScriptStoryboardPrepareTask(job)
    case TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN:
      return await handleEditScriptStoryboardCameraPlanTask(job)
    case TASK_TYPE.EPISODE_SPLIT_LLM:
      return await handleEpisodeSplitTask(job)
    case TASK_TYPE.EDIT_SCREENPLAY_GENERATE:
      return await handleEditScreenplayGenerateTask(job)
    case TASK_TYPE.EDIT_SCREENPLAY_REVISE:
      return await handleEditScreenplayReviseTask(job)
    case TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE:
      return await handleEditStylePreviewsGenerateTask(job)
    case TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE:
      return await handleEditDirectorDecoupageGenerateTask(job)
    case TASK_TYPE.EDIT_SCRIPT_GENERATE:
      return await handleEditScriptGenerateTask(job)
    case TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE:
      return await handleEditCinematographyShotPlanGenerateTask(job)
    case TASK_TYPE.AI_CREATE_CHARACTER:
    case TASK_TYPE.AI_CREATE_LOCATION:
    case TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER:
    case TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION:
      return await handleAssetHubAIDesignTask(job)
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER:
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION:
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP:
      return await handleAssetHubAIModifyTask(job)
    case TASK_TYPE.AI_MODIFY_APPEARANCE:
    case TASK_TYPE.AI_MODIFY_LOCATION:
    case TASK_TYPE.AI_MODIFY_PROP:
    case TASK_TYPE.AI_MODIFY_SHOT_PROMPT:
    case TASK_TYPE.ANALYZE_SHOT_VARIANTS:
      return await handleShotAITask(job)
    case TASK_TYPE.REFERENCE_TO_CHARACTER:
    case TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER:
      return await handleReferenceToCharacterTask(job)
    case TASK_TYPE.INSERT_PANEL:
      return await handleInsertPanelTask(job)
    default:
      throw new Error(`Unsupported text task type: ${job.data.type}`)
  }
}

export function createTextWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.TEXT,
    async (job) => await withTaskLifecycle(job, processTextTask),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_TEXT || '10', 10) || 10,
    },
  )
}
