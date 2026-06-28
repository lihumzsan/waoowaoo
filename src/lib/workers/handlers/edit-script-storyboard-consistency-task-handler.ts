import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { generateStoryboardPanelPrompts } from '@/lib/edit-script/storyboard-consistency/model-generation'
import {
  storyboardConsistencySourceSnapshotSchema,
  type StoryboardConsistencyModelConfigSnapshot,
  type StoryboardConsistencySourceSnapshot,
} from '@/lib/edit-script/storyboard-consistency/types'
import {
  upsertEditScriptStoryboard,
  upsertStoryboardPanelsFromPrompts,
} from '@/lib/edit-script/storyboard-consistency/persistence'

interface ParsedPayload {
  readonly editScriptId: string
  readonly sourceSnapshot: StoryboardConsistencySourceSnapshot
  readonly modelConfigSnapshot: StoryboardConsistencyModelConfigSnapshot
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function parsePayload(job: Job<TaskJobData>): ParsedPayload {
  const payload = readRecord(job.data.payload)
  const editScriptId = readString(payload.editScriptId) || job.data.targetId
  if (!editScriptId) throw new Error('EDIT_SCRIPT_STORYBOARD_EDIT_SCRIPT_ID_REQUIRED')
  const sourceSnapshot = storyboardConsistencySourceSnapshotSchema.parse(payload.sourceSnapshot)
  const modelConfigRaw = readRecord(payload.modelConfigSnapshot)
  const analysisModel = readString(modelConfigRaw.analysisModel)
  const storyboardModel = readString(modelConfigRaw.storyboardModel)
  if (!analysisModel) throw new Error('EDIT_SCRIPT_STORYBOARD_ANALYSIS_MODEL_REQUIRED')
  if (!storyboardModel) throw new Error('EDIT_SCRIPT_STORYBOARD_MODEL_REQUIRED')
  return {
    editScriptId,
    sourceSnapshot,
    modelConfigSnapshot: {
      analysisModel,
      storyboardModel,
    },
  }
}

function buildPhotographyPlan(input: {
  readonly stage: string
  readonly sourceSnapshot: StoryboardConsistencySourceSnapshot
  readonly modelConfigSnapshot: StoryboardConsistencyModelConfigSnapshot
  readonly errorMessage?: string | null
}) {
  return {
    source: 'edit_script',
    sourceType: 'editScriptStoryboard',
    consistencyMode: 'shot_execution_plan',
    currentStage: input.stage,
    editScriptId: input.sourceSnapshot.editScript.id,
    modelConfigSnapshot: input.modelConfigSnapshot,
    executionShotCount: input.sourceSnapshot.shotExecutionPlan.shots.length,
    generationSegmentCount: input.sourceSnapshot.generationSegments.length,
    errorMessage: input.errorMessage ?? null,
  }
}

export async function handleEditScriptStoryboardCameraPlanTask(job: Job<TaskJobData>) {
  const parsed = parsePayload(job)
  await reportTaskProgress(job, 20, { stage: 'edit_script_storyboard_build_facts' })
  let storyboardId: string | null = null
  try {
    const storyboard = await upsertEditScriptStoryboard({
      snapshot: parsed.sourceSnapshot,
      photographyPlan: buildPhotographyPlan({
        stage: 'building_panel_facts',
        sourceSnapshot: parsed.sourceSnapshot,
        modelConfigSnapshot: parsed.modelConfigSnapshot,
      }),
    })
    storyboardId = storyboard.id
    const generatedPanels = generateStoryboardPanelPrompts({
      snapshot: parsed.sourceSnapshot,
    })
    const panels = await upsertStoryboardPanelsFromPrompts({
      storyboardId: storyboard.id,
      snapshot: parsed.sourceSnapshot,
      generatedPanels,
    })
    await prisma.projectStoryboard.update({
      where: { id: storyboard.id },
      data: {
        photographyPlan: JSON.stringify(buildPhotographyPlan({
          stage: 'panel_prompts_ready',
          sourceSnapshot: parsed.sourceSnapshot,
          modelConfigSnapshot: parsed.modelConfigSnapshot,
        })),
        lastError: null,
      },
    })
    return { storyboardId: storyboard.id, panelCount: panels.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (storyboardId) {
      await prisma.projectStoryboard.update({
        where: { id: storyboardId },
        data: {
          lastError: message,
          photographyPlan: JSON.stringify(buildPhotographyPlan({
            stage: 'panel_prompts_failed',
            sourceSnapshot: parsed.sourceSnapshot,
            modelConfigSnapshot: parsed.modelConfigSnapshot,
            errorMessage: message,
          })),
        },
      }).catch(() => undefined)
    }
    throw error
  }
}
