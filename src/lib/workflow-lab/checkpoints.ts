import type { UIMessage } from 'ai'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  getEditFirstChoiceDefinition,
} from '@/lib/project-agent/edit-first-choice-tools'
import { parseProjectAgentChoiceOffer } from '@/lib/project-agent/choice-offer'
import type { ProjectAgentInterruptionPartData } from '@/lib/project-agent/types'
import type { WorkflowLabCheckpointSummary } from './types'

export interface WorkflowLabInterruptionSource {
  readonly id: string
  readonly runId: string | null
  readonly type: 'choice' | 'approval'
  readonly status: string
  readonly operationId: string
  readonly approvalId: string
  readonly toolCallId: string | null
  readonly payload: unknown
  readonly runState: string | null
}

const OPERATION_STAGE_BY_ID: Readonly<Record<string, EditFirstWorkflowStage>> = {
  ingest_script: 'ready_to_ingest_script',
  revise_script: 'script_ready_for_review',
  generate_bible_from_script: 'ready_to_generate_bible',
  revise_bible: 'bible_ready_for_review',
  generate_edit_style_previews: 'bible_ready_for_review',
  generate_edit_script: 'ready_to_generate_edit_script',
  generate_edit_script_assets: 'ready_to_generate_assets',
  generate_edit_shot_execution_plan: 'ready_to_generate_shot_execution_plan',
  generate_edit_script_storyboard: 'ready_to_generate_storyboard',
  generate_edit_script_storyboard_images: 'ready_to_generate_storyboard_images',
  generate_episode_videos: 'ready_to_generate_videos',
  generate_episode_bgm_score: 'ready_to_generate_videos',
  generate_episode_soundscape: 'ready_to_generate_videos',
  render_final_video: 'ready_to_render_final',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readApprovalInterruption(part: unknown): ProjectAgentInterruptionPartData | null {
  if (!isRecord(part) || part.type !== 'data-agent-interruption') return null
  const data = isRecord(part.data) ? part.data : null
  const runId = readString(data?.runId)
  const requestId = readString(data?.requestId)
  const interruptionId = readString(data?.interruptionId)
  const approvalId = readString(data?.approvalId)
  const operationId = readString(data?.operationId)
  const inputHash = readString(data?.inputHash)
  const display = isRecord(data?.display) ? data.display : null
  const title = readString(display?.title)
  const description = readString(display?.description)
  if (!runId || !requestId || !interruptionId || !approvalId || !operationId || !inputHash || !title || !description) {
    return null
  }
  return {
    runId,
    requestId,
    interruptionId,
    approvalId,
    operationId,
    inputHash,
    toolCallId: readString(data?.toolCallId),
    display: {
      title,
      description,
    },
  }
}

function readDynamicToolCallId(part: unknown): string | null {
  if (!isRecord(part) || part.type !== 'dynamic-tool') return null
  return readString(part.toolCallId)
}

function buildCheckpointId(params: {
  readonly kind: 'choice' | 'approval' | 'stage'
  readonly messageIndex: number
  readonly partIndex: number
  readonly stableId: string
}): string {
  return [
    params.kind,
    String(params.messageIndex),
    String(params.partIndex),
    params.stableId.replaceAll(':', '_'),
  ].join(':')
}

function readOperationBoundaryId(part: unknown): string | null {
  if (!isRecord(part)) return null
  if (part.type !== 'data-agent-operation-start' && part.type !== 'data-task-submitted') return null
  const data = isRecord(part.data) ? part.data : null
  return readString(data?.operationId)
}

function indexInterruptionsByToolCallId(
  interruptions: readonly WorkflowLabInterruptionSource[],
): ReadonlyMap<string, readonly WorkflowLabInterruptionSource[]> {
  const indexed = new Map<string, WorkflowLabInterruptionSource[]>()
  for (const interruption of interruptions) {
    if (!interruption.toolCallId) continue
    const current = indexed.get(interruption.toolCallId) ?? []
    current.push(interruption)
    indexed.set(interruption.toolCallId, current)
  }
  return indexed
}

function readUniqueToolCallInterruption(
  indexed: ReadonlyMap<string, readonly WorkflowLabInterruptionSource[]>,
  toolCallId: string | null | undefined,
): WorkflowLabInterruptionSource | null {
  if (!toolCallId) return null
  const candidates = indexed.get(toolCallId) ?? []
  return candidates.length === 1 ? candidates[0] ?? null : null
}

function isForkableApproval(
  interruption: WorkflowLabInterruptionSource | null | undefined,
): interruption is WorkflowLabInterruptionSource & { readonly type: 'approval'; readonly runState: string } {
  return interruption?.type === 'approval'
    && typeof interruption.runState === 'string'
    && interruption.runState.trim().length > 0
}

export function listWorkflowLabCheckpointsFromMessages(params: {
  readonly sourceEpisodeId: string
  readonly messages: readonly UIMessage[]
  readonly interruptions: readonly WorkflowLabInterruptionSource[]
}): readonly WorkflowLabCheckpointSummary[] {
  const checkpoints: WorkflowLabCheckpointSummary[] = []
  const seenStageCheckpointKeys = new Set<string>()
  const referencedInterruptionIds = new Set<string>()
  const interruptionById = new Map(params.interruptions.map((interruption) => [interruption.id, interruption]))
  const interruptionsByToolCallId = indexInterruptionsByToolCallId(params.interruptions)
  const approvalInterruptionIdsWithMessagePart = new Set(
    params.messages.flatMap((message) => message.parts.flatMap((part) => {
      const interruption = readApprovalInterruption(part)
      const durableApproval = interruption
        ? interruptionById.get(interruption.interruptionId)
          ?? readUniqueToolCallInterruption(interruptionsByToolCallId, interruption.toolCallId)
        : null
      return durableApproval?.type === 'approval' ? [durableApproval.id] : []
    })),
  )

  params.messages.forEach((message, messageIndex) => {
    if (message.role !== 'assistant') return
    message.parts.forEach((part, partIndex) => {
      const dynamicToolCallId = readDynamicToolCallId(part)
      const durableChoice = dynamicToolCallId
        ? readUniqueToolCallInterruption(interruptionsByToolCallId, dynamicToolCallId)
        : null
      if (durableChoice?.type === 'choice') {
        referencedInterruptionIds.add(durableChoice.id)
        const offer = parseProjectAgentChoiceOffer(durableChoice.payload)
        const stage = getEditFirstChoiceDefinition(offer.card.choiceType).workflowStage
        checkpoints.push({
          id: buildCheckpointId({
            kind: 'choice',
            messageIndex,
            partIndex,
            stableId: durableChoice.id,
          }),
          sourceEpisodeId: params.sourceEpisodeId,
          kind: 'choice',
          workflowStage: stage,
          title: offer.card.title,
          detail: offer.card.description ?? null,
          choiceType: offer.card.choiceType,
          operationId: EDIT_FIRST_CHOICE_TOOL_IDS[offer.card.choiceType],
          sourceInterruptionId: durableChoice.id,
          messageIndex,
          partIndex,
          assistantMessageCount: messageIndex + 1,
        })
        return
      }
      if (isForkableApproval(durableChoice) && !approvalInterruptionIdsWithMessagePart.has(durableChoice.id)) {
        referencedInterruptionIds.add(durableChoice.id)
        const stage = OPERATION_STAGE_BY_ID[durableChoice.operationId] ?? null
        if (stage) {
          checkpoints.push({
            id: buildCheckpointId({
              kind: 'approval',
              messageIndex,
              partIndex,
              stableId: durableChoice.id,
            }),
            sourceEpisodeId: params.sourceEpisodeId,
            kind: 'approval',
            workflowStage: stage,
            title: durableChoice.operationId,
            detail: null,
            choiceType: null,
            operationId: durableChoice.operationId,
            sourceInterruptionId: durableChoice.id,
            messageIndex,
            partIndex,
            assistantMessageCount: messageIndex + 1,
          })
          return
        }
      }

      const interruption = readApprovalInterruption(part)
      const durableApproval = interruption
        ? interruptionById.get(interruption.interruptionId)
          ?? readUniqueToolCallInterruption(interruptionsByToolCallId, interruption.toolCallId)
        : null
      const stage = isForkableApproval(durableApproval)
        ? OPERATION_STAGE_BY_ID[durableApproval.operationId] ?? null
        : null
      if (interruption && isForkableApproval(durableApproval) && stage) {
        referencedInterruptionIds.add(durableApproval.id)
        if (durableApproval.operationId !== interruption.operationId) {
          throw new Error(`WORKFLOW_LAB_APPROVAL_OPERATION_MISMATCH:${durableApproval.id}`)
        }
        checkpoints.push({
          id: buildCheckpointId({
            kind: 'approval',
            messageIndex,
            partIndex,
            stableId: durableApproval.id,
          }),
          sourceEpisodeId: params.sourceEpisodeId,
          kind: 'approval',
          workflowStage: stage,
          title: interruption.display.title,
          detail: interruption.display.description,
          choiceType: null,
          operationId: interruption.operationId,
          sourceInterruptionId: durableApproval.id,
          messageIndex,
          partIndex,
          assistantMessageCount: messageIndex + 1,
        })
        return
      }

      const boundaryOperationId = readOperationBoundaryId(part)
      const boundaryStage = boundaryOperationId ? OPERATION_STAGE_BY_ID[boundaryOperationId] ?? null : null
      if (!boundaryOperationId || !boundaryStage) return
      const stageKey = `${messageIndex}:${boundaryStage}:${boundaryOperationId}`
      if (seenStageCheckpointKeys.has(stageKey)) return
      seenStageCheckpointKeys.add(stageKey)
      checkpoints.push({
        id: buildCheckpointId({
          kind: 'stage',
          messageIndex,
          partIndex,
          stableId: `${boundaryStage}:${boundaryOperationId}`,
        }),
        sourceEpisodeId: params.sourceEpisodeId,
        kind: 'stage',
        workflowStage: boundaryStage,
        title: boundaryOperationId,
        detail: null,
        choiceType: null,
        operationId: boundaryOperationId,
        sourceInterruptionId: null,
        messageIndex,
        partIndex,
        assistantMessageCount: messageIndex + 1,
      })
    })
  })

  const finalMessageIndex = params.messages.length - 1
  const finalMessage = params.messages[finalMessageIndex]
  if (!finalMessage) return checkpoints
  const finalPartIndex = finalMessage.parts.length
  for (const interruption of params.interruptions) {
    if (interruption.status !== 'pending' || referencedInterruptionIds.has(interruption.id)) continue
    if (interruption.type === 'choice') {
      const offer = parseProjectAgentChoiceOffer(interruption.payload)
      const stage = getEditFirstChoiceDefinition(offer.card.choiceType).workflowStage
      checkpoints.push({
        id: buildCheckpointId({
          kind: 'choice',
          messageIndex: finalMessageIndex,
          partIndex: finalPartIndex,
          stableId: interruption.id,
        }),
        sourceEpisodeId: params.sourceEpisodeId,
        kind: 'choice',
        workflowStage: stage,
        title: offer.card.title,
        detail: offer.card.description ?? null,
        choiceType: offer.card.choiceType,
        operationId: EDIT_FIRST_CHOICE_TOOL_IDS[offer.card.choiceType],
        sourceInterruptionId: interruption.id,
        messageIndex: finalMessageIndex,
        partIndex: finalPartIndex,
        assistantMessageCount: params.messages.length,
      })
      continue
    }
    if (!isForkableApproval(interruption)) continue
    const stage = OPERATION_STAGE_BY_ID[interruption.operationId] ?? null
    if (!stage) continue
    checkpoints.push({
      id: buildCheckpointId({
        kind: 'approval',
        messageIndex: finalMessageIndex,
        partIndex: finalPartIndex,
        stableId: interruption.id,
      }),
      sourceEpisodeId: params.sourceEpisodeId,
      kind: 'approval',
      workflowStage: stage,
      title: interruption.operationId,
      detail: null,
      choiceType: null,
      operationId: interruption.operationId,
      sourceInterruptionId: interruption.id,
      messageIndex: finalMessageIndex,
      partIndex: finalPartIndex,
      assistantMessageCount: params.messages.length,
    })
  }

  return checkpoints
}

export function findWorkflowLabCheckpoint(params: {
  readonly sourceEpisodeId: string
  readonly messages: readonly UIMessage[]
  readonly interruptions: readonly WorkflowLabInterruptionSource[]
  readonly checkpointId: string
}): WorkflowLabCheckpointSummary | null {
  return listWorkflowLabCheckpointsFromMessages({
    sourceEpisodeId: params.sourceEpisodeId,
    messages: params.messages,
    interruptions: params.interruptions,
  }).find((checkpoint) => checkpoint.id === params.checkpointId) ?? null
}

export function sliceWorkflowLabMessagesAtCheckpoint(params: {
  readonly messages: readonly UIMessage[]
  readonly checkpoint: Pick<WorkflowLabCheckpointSummary, 'messageIndex' | 'partIndex'>
  readonly includeCheckpointPart: boolean
}): UIMessage[] {
  const targetMessage = params.messages[params.checkpoint.messageIndex]
  if (!targetMessage) throw new Error('WORKFLOW_LAB_CHECKPOINT_MESSAGE_NOT_FOUND')
  const targetParts = targetMessage.parts.slice(
    0,
    params.checkpoint.partIndex + (params.includeCheckpointPart ? 1 : 0),
  )
  if (targetParts.length === 0) {
    return params.messages.slice(0, params.checkpoint.messageIndex)
  }
  return [
    ...params.messages.slice(0, params.checkpoint.messageIndex),
    {
      ...targetMessage,
      parts: targetParts,
    },
  ]
}
