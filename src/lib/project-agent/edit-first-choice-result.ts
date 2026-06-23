import { randomUUID } from 'node:crypto'
import type { AgentInputItem } from '@openai/agents'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import { EDIT_FIRST_CHOICE_TOOL_IDS, type EditFirstChoiceType } from './edit-first-choice-tools'
import { approveProjectEditScriptAssets } from '@/lib/edit-script/service'
import {
  isEditFirstDurationTier,
  type EditFirstDurationTier,
} from '@/lib/edit-script/duration-tier'

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

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readAspectRatio(value: unknown): EditScriptVideoRatio | null {
  if (value === '9:16' || value === '16:9' || value === '21:9') return value
  return null
}

function readDurationTier(output: UnknownRecord): EditFirstDurationTier | null {
  const direct = output.durationTier
  if (isEditFirstDurationTier(direct)) return direct
  const selections = isRecord(output.selections) ? output.selections : null
  const selected = selections?.durationTier
  if (isEditFirstDurationTier(selected)) return selected
  return null
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

  if (params.choiceType === 'duration_and_aspect_ratio') {
    const durationTier = readDurationTier(params.output)
    const aspectRatio = readAspectRatio(params.output.aspectRatio)
    if (!durationTier || !aspectRatio || !params.latestUserText) return null
    return {
      inputItems: buildChoiceInputItems({
        toolCallId: params.toolCallId,
        choiceType: params.choiceType,
        result: {
          prompt: params.latestUserText,
          durationTier,
          aspectRatio,
        },
      }),
    }
  }

  if (params.choiceType === 'screenplay_review') {
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
      return {
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'approve' },
        }),
      }
    }
    return null
  }

  if (params.choiceType === 'asset_review') {
    const decision = readString(params.output.decision)
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
}): Promise<void> {
  if (params.output.ok !== true && params.output.ok !== undefined) return
  if (params.choiceType !== 'asset_review') return
  const decision = readString(params.output.decision)
  if (decision !== 'approve') return
  if (!params.episodeId) {
    throw new Error('PROJECT_AGENT_ASSET_REVIEW_EPISODE_ID_REQUIRED')
  }
  await approveProjectEditScriptAssets({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
  })
}
