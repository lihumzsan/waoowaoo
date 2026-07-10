import { randomUUID } from 'node:crypto'
import type { AgentInputItem } from '@openai/agents'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { EditFirstReviewChoiceDecision } from '@/lib/project-workflow/edit-first'
import { EDIT_FIRST_CHOICE_TOOL_IDS, type EditFirstChoiceType } from './edit-first-choice-tools'
import { normalizeScriptIntakeChoiceBrief } from './script-intake'

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
  reviewDecision: EditFirstReviewChoiceDecision | null
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
      reviewDecision: null,
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
        reviewDecision: { choiceType: 'bible_review', decision: 'revise' },
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
        reviewDecision: { choiceType: 'bible_review', decision: 'approve' },
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
        reviewDecision: { choiceType: 'script_review', decision: 'revise' },
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'revise', revisionNotes },
        }),
      }
    }
    if (decision !== 'approve') return null
    return {
      reviewDecision: { choiceType: 'script_review', decision: 'approve' },
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
        reviewDecision: { choiceType: 'asset_review', decision: 'revise' },
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'revise', revisionNotes },
        }),
      }
    }
    if (decision !== 'approve') return null
    return {
      reviewDecision: { choiceType: 'asset_review', decision: 'approve' },
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
    reviewDecision: null,
    inputItems: buildChoiceInputItems({
      toolCallId: params.toolCallId,
      choiceType: params.choiceType,
      result: { stylePreviewId, aspectRatio, saved: true },
    }),
  }
}
