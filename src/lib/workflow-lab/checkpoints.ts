import type { UIMessage } from 'ai'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { EDIT_FIRST_CHOICE_TOOL_IDS, type EditFirstChoiceType } from '@/lib/project-agent/edit-first-choice-tools'
import type {
  ProjectAgentChoiceCardPartData,
  ProjectAgentInterruptionPartData,
} from '@/lib/project-agent/types'
import type { WorkflowLabCheckpointSummary } from './types'

const CHOICE_STAGE_BY_TYPE: Record<EditFirstChoiceType, EditFirstWorkflowStage> = {
  duration_and_aspect_ratio: 'ready_to_generate_screenplay',
  screenplay_review: 'screenplay_ready_for_review',
  style: 'needs_style_choice',
  asset_review: 'assets_ready_for_review',
}

const OPERATION_STAGE_BY_ID: Readonly<Record<string, EditFirstWorkflowStage>> = {
  generate_edit_screenplay: 'ready_to_generate_screenplay',
  revise_edit_screenplay: 'screenplay_ready_for_review',
  generate_edit_style_previews: 'screenplay_ready_for_review',
  generate_edit_director_decoupage: 'ready_to_generate_director_decoupage',
  generate_edit_script: 'ready_to_generate_edit_script',
  generate_edit_script_assets: 'ready_to_generate_assets',
  generate_edit_cinematography_shot_plan: 'ready_to_generate_cinematography',
  generate_edit_script_storyboard_spatial_blocking: 'ready_to_generate_storyboard_spatial_blocking',
  generate_edit_script_storyboard: 'ready_to_generate_storyboard',
  generate_edit_script_storyboard_images: 'ready_to_generate_storyboard_images',
  generate_episode_videos: 'ready_to_generate_videos',
  render_final_video: 'ready_to_render_final',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readChoiceType(value: unknown): EditFirstChoiceType | null {
  if (
    value === 'duration_and_aspect_ratio'
    || value === 'screenplay_review'
    || value === 'style'
    || value === 'asset_review'
  ) return value
  return null
}

function readChoiceCard(part: unknown): ProjectAgentChoiceCardPartData | null {
  if (!isRecord(part) || part.type !== 'data-assistant-choice-card') return null
  const data = isRecord(part.data) ? part.data : null
  const cardId = readString(data?.cardId)
  const toolCallId = readString(data?.toolCallId)
  const choiceType = readChoiceType(data?.choiceType)
  const title = readString(data?.title)
  const submitLabel = readString(data?.submitLabel)
  if (!cardId || !toolCallId || !choiceType || !title || !submitLabel || !Array.isArray(data?.groups)) {
    return null
  }
  return data as unknown as ProjectAgentChoiceCardPartData
}

function readApprovalInterruption(part: unknown): ProjectAgentInterruptionPartData | null {
  if (!isRecord(part) || part.type !== 'data-agent-interruption') return null
  const data = isRecord(part.data) ? part.data : null
  const runId = readString(data?.runId)
  const requestId = readString(data?.requestId)
  const interruptionId = readString(data?.interruptionId)
  const approvalId = readString(data?.approvalId)
  const operationId = readString(data?.operationId)
  const display = isRecord(data?.display) ? data.display : null
  const title = readString(display?.title)
  const description = readString(display?.description)
  if (!runId || !requestId || !interruptionId || !approvalId || !operationId || !title || !description) {
    return null
  }
  return {
    runId,
    requestId,
    interruptionId,
    approvalId,
    operationId,
    toolCallId: readString(data?.toolCallId),
    display: {
      title,
      description,
    },
  }
}

function buildCheckpointId(params: {
  readonly kind: 'choice' | 'approval'
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

export function listWorkflowLabCheckpointsFromMessages(params: {
  readonly sourceEpisodeId: string
  readonly messages: readonly UIMessage[]
}): readonly WorkflowLabCheckpointSummary[] {
  const checkpoints: WorkflowLabCheckpointSummary[] = []

  params.messages.forEach((message, messageIndex) => {
    if (message.role !== 'assistant') return
    message.parts.forEach((part, partIndex) => {
      const choiceCard = readChoiceCard(part)
      if (choiceCard) {
        const stage = CHOICE_STAGE_BY_TYPE[choiceCard.choiceType]
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
      if (!interruption || !stage) return
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
