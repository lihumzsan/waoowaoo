import { randomUUID } from 'node:crypto'
import type { AgentInputItem } from '@openai/agents'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import { prisma } from '@/lib/prisma'
import { EDIT_FIRST_CHOICE_TOOL_IDS, type EditFirstChoiceType } from './edit-first-choice-tools'
import { approveProjectEpisodeEditScriptAssets } from '@/lib/edit-script/service'
import { approveEpisodePromptGeneratedScript, confirmEpisodeEditBible } from '@/lib/edit-bible'
import { normalizeScriptIntakeChoiceBrief } from './script-intake'
import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import type { ProjectAgentChoiceCardPartData } from './types'
import { submitProjectEditStylePreviewsGenerationTask } from '@/lib/edit-script/task-submission'
import { TASK_TYPE } from '@/lib/task/types'

interface UnknownRecord {
  [key: string]: unknown
}

export interface EditFirstChoiceResult {
  /**
   * Synthetic function_call/function_call_result pair injected into the next
   * run input so the model sees its own choice request answered in-band,
   * instead of receiving the choice through system-prompt prose. This only
   * carries the user's structured choice result; it never selects the next
   * operation.
   */
  inputItems: AgentInputItem[]
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readAspectRatio(value: unknown): EditScriptVideoRatio | null {
  if (value === '9:16' || value === '16:9' || value === '21:9') return value
  return null
}

function readChoiceAspectRatio(output: UnknownRecord): EditScriptVideoRatio | null {
  const direct = readAspectRatio(output.aspectRatio)
  if (direct) return direct
  const selections = output.selections
  if (!isRecord(selections)) return null
  return readAspectRatio(selections.aspectRatio)
}

function buildChoiceInputItems(params: {
  toolCallId: string | null
  choiceType: EditFirstChoiceType
  result: UnknownRecord
}): AgentInputItem[] {
  const callId = params.toolCallId ?? `edit_first_choice_${randomUUID()}`
  const toolName = EDIT_FIRST_CHOICE_TOOL_IDS[params.choiceType]
  return [
    {
      type: 'function_call',
      callId,
      name: toolName,
      status: 'completed',
      arguments: JSON.stringify({}),
    } as AgentInputItem,
    {
      type: 'function_call_result',
      callId,
      name: toolName,
      status: 'completed',
      output: {
        type: 'text',
        text: JSON.stringify({
          ok: true,
          choiceType: params.choiceType,
          ...params.result,
        }),
      },
    } as AgentInputItem,
  ]
}

export function buildEditFirstChoiceResult(params: {
  choiceType: EditFirstChoiceType
  toolCallId: string | null
  output: UnknownRecord
  latestUserText: string
}): EditFirstChoiceResult | null {
  if (params.output.ok !== true && params.output.ok !== undefined) return null

  if (params.choiceType === 'script_intake') {
    const normalizedBrief = normalizeScriptIntakeChoiceBrief({
      seedText: params.latestUserText,
      output: params.output,
    })
    if (!normalizedBrief) return null
    return {
      inputItems: buildChoiceInputItems({
        toolCallId: params.toolCallId,
        choiceType: params.choiceType,
        result: { decision: 'submit', normalizedBrief },
      }),
    }
  }

  if (params.choiceType === 'bible_review') {
    const decision = readString(params.output.decision)
    if (decision === 'revise') {
      const revisionNotes = readString(params.output.revisionNotes) ?? readString(params.output.replyText)
      if (!revisionNotes) return null
      return {
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'revise', revisionNotes },
        }),
      }
    }
    if (decision === 'approve') {
      const aspectRatio = readChoiceAspectRatio(params.output)
      if (!aspectRatio) return null
      return {
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'approve', aspectRatio },
        }),
      }
    }
    return null
  }

  if (params.choiceType === 'script_review') {
    const decision = readString(params.output.decision)
    if (decision === 'revise') {
      const revisionNotes = readString(params.output.revisionNotes) ?? readString(params.output.replyText)
      if (!revisionNotes) return null
      return {
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'revise', revisionNotes },
        }),
      }
    }
    if (decision !== 'approve') return null
    return {
      inputItems: buildChoiceInputItems({
        toolCallId: params.toolCallId,
        choiceType: params.choiceType,
        result: { decision: 'approve' },
      }),
    }
  }

  if (params.choiceType === 'asset_review') {
    const decision = readString(params.output.decision)
    if (decision === 'revise') {
      const revisionNotes = readString(params.output.revisionNotes) ?? readString(params.output.replyText)
      if (!revisionNotes) return null
      return {
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'revise', revisionNotes },
        }),
      }
    }
    if (decision !== 'approve') return null
    return {
      inputItems: buildChoiceInputItems({
        toolCallId: params.toolCallId,
        choiceType: params.choiceType,
        result: { decision: 'approve' },
      }),
    }
  }

  const stylePreviewId = readString(params.output.stylePreviewId)
  const aspectRatio = readAspectRatio(params.output.aspectRatio)
  if (!stylePreviewId || !aspectRatio) return null
  return {
    inputItems: buildChoiceInputItems({
      toolCallId: params.toolCallId,
      choiceType: params.choiceType,
      result: { stylePreviewId, aspectRatio, saved: true },
    }),
  }
}

export async function applyEditFirstChoiceResultSideEffects(params: {
  choiceType: EditFirstChoiceType
  output: UnknownRecord
  projectId: string
  userId: string
  episodeId: string | null
  request?: NextRequest
  locale?: Locale
  persistedChoiceCard?: ProjectAgentChoiceCardPartData | null
}): Promise<void> {
  if (params.output.ok !== true && params.output.ok !== undefined) return
  const decision = readString(params.output.decision)
  if (params.choiceType === 'script_intake') return
  if (params.choiceType === 'script_review') {
    if (decision !== 'approve') return
    if (!params.episodeId) {
      throw new Error('PROJECT_AGENT_SCRIPT_REVIEW_EPISODE_ID_REQUIRED')
    }
    await approveEpisodePromptGeneratedScript({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
    })
    return
  }
  if (params.choiceType === 'bible_review') {
    if (decision !== 'approve') return
    const aspectRatio = readChoiceAspectRatio(params.output)
    if (!aspectRatio) {
      throw new Error('PROJECT_AGENT_BIBLE_REVIEW_ASPECT_RATIO_REQUIRED')
    }
    if (!params.episodeId) {
      throw new Error('PROJECT_AGENT_BIBLE_REVIEW_EPISODE_ID_REQUIRED')
    }
    if (!params.request || !params.locale) {
      throw new Error('PROJECT_AGENT_BIBLE_REVIEW_SUBMISSION_CONTEXT_REQUIRED')
    }
    const operationPlan = params.persistedChoiceCard?.operationPlan
    if (!operationPlan || operationPlan.operationId !== 'generate_edit_style_previews') {
      throw new Error('PROJECT_AGENT_BIBLE_REVIEW_STYLE_PLAN_REQUIRED')
    }
    if (operationPlan.tasks.length < 1 || operationPlan.tasks.length !== operationPlan.quote.mediaTaskCount) {
      throw new Error('PROJECT_AGENT_BIBLE_REVIEW_STYLE_PLAN_TASKS_INVALID')
    }
    const plannedStylePreviewIds = operationPlan.tasks.map((task) => {
      if (task.taskType !== TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE || task.targetType !== 'ProjectEditStylePreview') {
        throw new Error('PROJECT_AGENT_BIBLE_REVIEW_STYLE_PLAN_TARGET_INVALID')
      }
      return task.targetId
    })
    const imageModels = new Set(operationPlan.quote.items.map((item) => item.model))
    if (imageModels.size !== 1) throw new Error('PROJECT_AGENT_BIBLE_REVIEW_STYLE_PLAN_MODEL_INVALID')
    const plannedImageModel = operationPlan.quote.items[0]?.model
    if (!plannedImageModel) throw new Error('PROJECT_AGENT_BIBLE_REVIEW_STYLE_PLAN_MODEL_REQUIRED')
    const project = await prisma.project.findFirst({
      where: { id: params.projectId, userId: params.userId },
      select: { videoRatio: true },
    })
    if (!project) throw new Error('PROJECT_AGENT_BIBLE_REVIEW_PROJECT_NOT_FOUND')
    const updateResult = await prisma.project.updateMany({
      where: {
        id: params.projectId,
        userId: params.userId,
      },
      data: {
        videoRatio: aspectRatio,
      },
    })
    if (updateResult.count !== 1) {
      throw new Error('PROJECT_AGENT_BIBLE_REVIEW_PROJECT_NOT_FOUND')
    }
    try {
      const bible = await confirmEpisodeEditBible({
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId,
      })
      const userApprovedPlan = decision === 'approve'
      await submitProjectEditStylePreviewsGenerationTask({
        request: params.request,
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId,
        bibleId: bible.id,
        count: plannedStylePreviewIds.length,
        plannedStylePreviewIds,
        plannedImageModel,
        confirmedMaxCost: operationPlan.quote.totalMaxFrozenCost ?? null,
        source: 'assistant-production-plan-choice',
        confirmed: userApprovedPlan,
        locale: params.locale,
      })
    } catch (error) {
      await prisma.$transaction([
        prisma.project.update({
          where: { id: params.projectId },
          data: { videoRatio: project.videoRatio },
        }),
        prisma.projectEditBible.updateMany({
          where: {
            episodeId: params.episodeId,
            status: 'confirmed',
          },
          data: {
            status: 'ready_for_review',
            lockedAt: null,
          },
        }),
      ])
      throw error
    }
    return
  }
  if (params.choiceType !== 'asset_review') return
  if (decision !== 'approve') return
  if (!params.episodeId) {
    throw new Error('PROJECT_AGENT_ASSET_REVIEW_EPISODE_ID_REQUIRED')
  }
  await approveProjectEpisodeEditScriptAssets({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
  })
}
