import type { UIMessage } from 'ai'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  getEditFirstChoiceDefinition,
} from '@/lib/project-agent/edit-first-choice-tools'
import type {
  ProjectAgentChoiceCardPartData,
  ProjectAgentInterruptionPartData,
} from '@/lib/project-agent/types'
import { projectAgentChoiceCardSchema } from '@/lib/project-agent/choice-offer'
import type { WorkflowLabCheckpointSummary } from './types'

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

function readChoiceWorkflowStage(choiceCard: ProjectAgentChoiceCardPartData): EditFirstWorkflowStage | null {
  return getEditFirstChoiceDefinition(choiceCard.choiceType).workflowStage
}

function readChoiceCard(part: unknown): ProjectAgentChoiceCardPartData | null {
  if (!isRecord(part) || part.type !== 'data-assistant-choice-card') return null
  const parsed = projectAgentChoiceCardSchema.safeParse(part.data)
  return parsed.success ? parsed.data : null
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

export function listWorkflowLabCheckpointsFromMessages(params: {
  readonly sourceEpisodeId: string
  readonly messages: readonly UIMessage[]
}): readonly WorkflowLabCheckpointSummary[] {
  const checkpoints: WorkflowLabCheckpointSummary[] = []
  const seenStageCheckpointKeys = new Set<string>()

  params.messages.forEach((message, messageIndex) => {
    if (message.role !== 'assistant') return
    message.parts.forEach((part, partIndex) => {
      const choiceCard = readChoiceCard(part)
      if (choiceCard) {
        const stage = readChoiceWorkflowStage(choiceCard)
        if (!stage) return
        checkpoints.push({
          id: buildCheckpointId({
            kind: 'choice',
            messageIndex,
            partIndex,
            stableId: choiceCard.cardId,
          }),
          sourceEpisodeId: params.sourceEpisodeId,
          kind: 'choice',
          workflowStage: stage,
          title: choiceCard.title,
          detail: choiceCard.description ?? null,
          choiceType: choiceCard.choiceType,
          operationId: EDIT_FIRST_CHOICE_TOOL_IDS[choiceCard.choiceType],
          messageIndex,
          partIndex,
          assistantMessageCount: messageIndex + 1,
        })
        return
      }

      const interruption = readApprovalInterruption(part)
      const stage = interruption ? OPERATION_STAGE_BY_ID[interruption.operationId] ?? null : null
      if (interruption && stage) {
        checkpoints.push({
          id: buildCheckpointId({
            kind: 'approval',
            messageIndex,
            partIndex,
            stableId: interruption.operationId,
          }),
          sourceEpisodeId: params.sourceEpisodeId,
          kind: 'approval',
          workflowStage: stage,
          title: interruption.display.title,
          detail: interruption.display.description,
          choiceType: null,
          operationId: interruption.operationId,
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
        messageIndex,
        partIndex,
        assistantMessageCount: messageIndex + 1,
      })
    })
  })

  return checkpoints
}

export function findWorkflowLabCheckpoint(params: {
  readonly sourceEpisodeId: string
  readonly messages: readonly UIMessage[]
  readonly checkpointId: string
}): WorkflowLabCheckpointSummary | null {
  return listWorkflowLabCheckpointsFromMessages({
    sourceEpisodeId: params.sourceEpisodeId,
    messages: params.messages,
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
