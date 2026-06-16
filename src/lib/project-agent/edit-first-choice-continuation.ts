import { randomUUID } from 'node:crypto'
import type { AgentInputItem } from '@openai/agents'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { EditFirstChoiceType } from './choice-card'
import {
  isEditFirstDurationTier,
  type EditFirstDurationTier,
} from '@/lib/edit-script/duration-tier'

type ChoiceContinuationOperationId =
  | 'generate_edit_screenplay'
  | 'generate_edit_style_previews'
  | 'revise_edit_screenplay'
  | 'generate_edit_director_decoupage'

interface UnknownRecord {
  [key: string]: unknown
}

export interface EditFirstChoiceContinuation {
  operationId: ChoiceContinuationOperationId
  /**
   * Synthetic function_call/function_call_result pair injected into the next
   * run input so the model sees its own choice request answered in-band,
   * instead of receiving the choice through system-prompt prose.
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
  nextOperationId: ChoiceContinuationOperationId
}): AgentInputItem[] {
  const callId = params.toolCallId ?? `edit_first_choice_${randomUUID()}`
  return [
    {
      type: 'function_call',
      callId,
      name: 'request_edit_first_choice',
      status: 'completed',
      arguments: JSON.stringify({ choiceType: params.choiceType }),
    } as AgentInputItem,
    {
      type: 'function_call_result',
      callId,
      name: 'request_edit_first_choice',
      status: 'completed',
      output: {
        type: 'text',
        text: JSON.stringify({
          ok: true,
          choiceType: params.choiceType,
          nextOperationId: params.nextOperationId,
          ...params.result,
        }),
      },
    } as AgentInputItem,
  ]
}

export function resolveEditFirstChoiceContinuation(params: {
  choiceType: EditFirstChoiceType
  toolCallId: string | null
  output: UnknownRecord
  latestUserText: string
}): EditFirstChoiceContinuation | null {
  if (params.output.ok !== true && params.output.ok !== undefined) return null

  if (params.choiceType === 'duration_and_aspect_ratio') {
    const durationTier = readDurationTier(params.output)
    const aspectRatio = readAspectRatio(params.output.aspectRatio)
    if (!durationTier || !aspectRatio || !params.latestUserText) return null
    return {
      operationId: 'generate_edit_screenplay',
      inputItems: buildChoiceInputItems({
        toolCallId: params.toolCallId,
        choiceType: params.choiceType,
        nextOperationId: 'generate_edit_screenplay',
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
        operationId: 'revise_edit_screenplay',
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          nextOperationId: 'revise_edit_screenplay',
          result: { decision: 'revise', revisionNotes },
        }),
      }
    }
    if (decision === 'approve') {
      return {
        operationId: 'generate_edit_style_previews',
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          nextOperationId: 'generate_edit_style_previews',
          result: { decision: 'approve' },
        }),
      }
    }
    return null
  }

  const stylePreviewId = readString(params.output.stylePreviewId)
  const aspectRatio = readAspectRatio(params.output.aspectRatio)
  if (!stylePreviewId || !aspectRatio) return null
  return {
    operationId: 'generate_edit_director_decoupage',
    inputItems: buildChoiceInputItems({
      toolCallId: params.toolCallId,
      choiceType: params.choiceType,
      nextOperationId: 'generate_edit_director_decoupage',
      result: { stylePreviewId, aspectRatio, saved: true },
    }),
  }
}
