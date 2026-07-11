import type { AgentInputItem } from '@openai/agents'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { EditFirstWorkflowChoiceDecision } from '@/lib/project-workflow/edit-first'
import {
  getEditFirstChoiceDefinition,
  type EditFirstChoiceType,
} from './edit-first-choice-tools'
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
  decision: EditFirstChoiceDecision
  choiceDecision: EditFirstWorkflowChoiceDecision
}

export type EditFirstChoiceDecision =
  | { choiceType: 'script_intake'; decision: 'submit'; normalizedBrief: string }
  | { choiceType: 'script_review'; decision: 'approve' }
  | { choiceType: 'script_review'; decision: 'revise'; revisionNotes: string }
  | { choiceType: 'bible_review'; decision: 'approve'; aspectRatio: EditScriptVideoRatio }
  | { choiceType: 'bible_review'; decision: 'revise'; revisionNotes: string }
  | { choiceType: 'asset_review'; decision: 'approve' }
  | { choiceType: 'asset_review'; decision: 'revise'; revisionNotes: string }
  | { choiceType: 'style'; decision: 'select'; stylePreviewId: string }

export interface EditFirstChoiceDecisionInput {
  output: UnknownRecord
  latestUserText: string
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
  toolCallId: string
  choiceType: EditFirstChoiceType
  result: UnknownRecord
}): AgentInputItem[] {
  const callId = params.toolCallId
  const toolName = getEditFirstChoiceDefinition(params.choiceType).toolId
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

export function parseScriptIntakeChoiceDecision(
  params: EditFirstChoiceDecisionInput,
): Extract<EditFirstChoiceDecision, { choiceType: 'script_intake' }> | null {
  if (params.output.ok !== true && params.output.ok !== undefined) return null
  const normalizedBrief = normalizeScriptIntakeChoiceBrief({
    seedText: params.latestUserText,
    output: params.output,
  })
  if (!normalizedBrief) return null
  return { choiceType: 'script_intake', decision: 'submit', normalizedBrief }
}

export function parseBibleReviewChoiceDecision(
  params: EditFirstChoiceDecisionInput,
): Extract<EditFirstChoiceDecision, { choiceType: 'bible_review' }> | null {
  if (params.output.ok !== true && params.output.ok !== undefined) return null
  const decision = readString(params.output.decision)
  if (decision === 'revise') {
    const revisionNotes = readString(params.output.revisionNotes) ?? readString(params.output.replyText)
    if (!revisionNotes) return null
    return { choiceType: 'bible_review', decision: 'revise', revisionNotes }
  }
  if (decision === 'approve') {
    const aspectRatio = readChoiceAspectRatio(params.output)
    if (!aspectRatio) return null
    return { choiceType: 'bible_review', decision: 'approve', aspectRatio }
  }
  return null
}

export function parseScriptReviewChoiceDecision(
  params: EditFirstChoiceDecisionInput,
): Extract<EditFirstChoiceDecision, { choiceType: 'script_review' }> | null {
  if (params.output.ok !== true && params.output.ok !== undefined) return null
  const decision = readString(params.output.decision)
  if (decision === 'revise') {
    const revisionNotes = readString(params.output.revisionNotes) ?? readString(params.output.replyText)
    if (!revisionNotes) return null
    return { choiceType: 'script_review', decision: 'revise', revisionNotes }
  }
  return decision === 'approve'
    ? { choiceType: 'script_review', decision: 'approve' }
    : null
}

export function parseAssetReviewChoiceDecision(
  params: EditFirstChoiceDecisionInput,
): Extract<EditFirstChoiceDecision, { choiceType: 'asset_review' }> | null {
  if (params.output.ok !== true && params.output.ok !== undefined) return null
  const decision = readString(params.output.decision)
  if (decision === 'revise') {
    const revisionNotes = readString(params.output.revisionNotes) ?? readString(params.output.replyText)
    if (!revisionNotes) return null
    return { choiceType: 'asset_review', decision: 'revise', revisionNotes }
  }
  return decision === 'approve'
    ? { choiceType: 'asset_review', decision: 'approve' }
    : null
}

export function parseStyleChoiceDecision(
  params: EditFirstChoiceDecisionInput,
): Extract<EditFirstChoiceDecision, { choiceType: 'style' }> | null {
  if (params.output.ok !== true && params.output.ok !== undefined) return null
  const selections = isRecord(params.output.selections) ? params.output.selections : null
  const stylePreviewId = readString(params.output.stylePreviewId)
    ?? readString(selections?.stylePreviewId)
  if (!stylePreviewId) return null
  return {
    choiceType: 'style',
    decision: 'select',
    stylePreviewId,
  }
}

export function parseEditFirstChoiceDecision(params: {
  choiceType: EditFirstChoiceType
  output: UnknownRecord
  latestUserText: string
}): EditFirstChoiceDecision | null {
  return getEditFirstChoiceDefinition(params.choiceType).parseDecision({
    output: params.output,
    latestUserText: params.latestUserText,
  })
}

export function buildEditFirstChoiceResultFromDecision(params: {
  decision: EditFirstChoiceDecision
  toolCallId: string
}): EditFirstChoiceResult {
  const decision = params.decision
  const definition = getEditFirstChoiceDefinition(decision.choiceType)
  const choiceDecision: EditFirstWorkflowChoiceDecision = definition.toWorkflowDecision(decision)
  const result = definition.serializeDecision(decision)
  return {
    decision,
    choiceDecision,
    inputItems: buildChoiceInputItems({
      toolCallId: params.toolCallId,
      choiceType: decision.choiceType,
      result,
    }),
  }
}

export function buildEditFirstChoiceResult(params: {
  choiceType: EditFirstChoiceType
  toolCallId: string
  output: UnknownRecord
  latestUserText: string
}): EditFirstChoiceResult | null {
  const decision = parseEditFirstChoiceDecision(params)
  if (!decision) return null
  return buildEditFirstChoiceResultFromDecision({
    decision,
    toolCallId: params.toolCallId,
  })
}
