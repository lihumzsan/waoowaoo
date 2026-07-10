import { Prisma } from '@prisma/client'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { createDefaultEditChapter } from '@/lib/edit-chapter'
import { appendProjectAgentEventsInTransaction } from '@/lib/project-agent/event'
import { buildProjectAssistantScopeRef, loadProjectAssistantThread } from '@/lib/project-agent/persistence'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'
import {
  buildProjectAgentChoiceOffer,
  resolveCurrentProjectAgentChoiceReviewedResource,
} from '@/lib/project-agent/choice-offer'
import { createInitialProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import {
  resolveEditFirstWorkflowState,
  type EditFirstWorkflowState,
} from '@/lib/project-workflow/edit-first'
import { cloneEpisodeProjectData } from './clone-episode-project-data'
import { cloneWorkflowLabProjectAssets } from './clone-project-assets'
import {
  createWorkflowLabCloneMaps,
  mapWorkflowLabId,
  type WorkflowLabCloneMaps,
} from './clone-json'
import {
  findWorkflowLabCheckpoint,
  listWorkflowLabCheckpointsFromMessages,
  sliceWorkflowLabMessagesAtCheckpoint,
} from './checkpoints'
import {
  buildWorkflowLabMessageReplacementMap,
  rewriteWorkflowLabAssistantMessages,
} from './message-rewrite'
import type {
  WorkflowLabCheckpointListResult,
  WorkflowLabCheckpointSummary,
  WorkflowLabEpisodeSummary,
  WorkflowLabForkResult,
  WorkflowLabProjectSummary,
} from './types'

const WORKFLOW_LAB_NAME_PREFIX = '[LAB]'
const WORKFLOW_LAB_TRANSACTION_TIMEOUT_MS = 30_000

function isWorkflowLabExplicitlyEnabled(): boolean {
  const value = process.env.WORKFLOW_LAB_ENABLED?.trim().toLowerCase() ?? ''
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function isWorkflowLabEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || isWorkflowLabExplicitlyEnabled()
}

function assertWorkflowLabEnabled() {
  if (isWorkflowLabEnabled()) return
  throw new ApiError('FORBIDDEN', {
    code: 'WORKFLOW_LAB_DISABLED',
    message: 'workflow lab is disabled',
  })
}

function summarizeEpisode(
  episode: { readonly id: string; readonly name: string; readonly episodeNumber: number },
  workflow: EditFirstWorkflowState,
): WorkflowLabEpisodeSummary {
  return {
    id: episode.id,
    name: episode.name,
    episodeNumber: episode.episodeNumber,
    workflowStage: workflow.stage,
    blockingKind: workflow.blocking.kind,
    blockingReason: workflow.blocking.reason,
    nextOperationId: workflow.nextAction?.operationId ?? null,
    allowedOperationIds: workflow.allowedOperationIds,
  }
}

function summarizeProject(project: { readonly id: string; readonly name: string }): WorkflowLabProjectSummary {
  return {
    id: project.id,
    name: project.name,
  }
}

function buildLabProjectName(params: {
  readonly sourceName: string
  readonly stage: string
}): string {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  return `${WORKFLOW_LAB_NAME_PREFIX} ${params.stage} - ${params.sourceName} - ${timestamp}`
}

async function loadSourceThread(params: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
}) {
  return await loadProjectAssistantThread({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    assistantId: 'workspace-command',
  })
}

async function validateWorkflowLabMessages(messages: readonly UIMessage[]): Promise<UIMessage[]> {
  const validation = await safeValidateUIMessages({ messages })
  if (!validation.success) {
    throw new Error('WORKFLOW_LAB_ASSISTANT_MESSAGES_INVALID')
  }
  return ensureUniqueUIMessages(validation.data)
}

function serializeWorkflowLabMessages(messages: readonly UIMessage[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(messages)) as Prisma.InputJsonValue
}

function serializeWorkflowLabValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function findSourceEpisode(params: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
}) {
  const episode = await prisma.projectEpisode.findFirst({
    where: {
      id: params.episodeId,
      projectId: params.projectId,
      project: {
        userId: params.userId,
      },
    },
    select: {
      id: true,
      projectId: true,
      episodeNumber: true,
      name: true,
      description: true,
      novelText: true,
      audioUrl: true,
      audioMediaId: true,
      srtContent: true,
    },
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND', {
      code: 'WORKFLOW_LAB_SOURCE_EPISODE_NOT_FOUND',
      message: 'source episode not found',
    })
  }
  return episode
}

export async function listWorkflowLabCheckpoints(params: {
  readonly projectId: string
  readonly userId: string
  readonly sourceEpisodeId: string
}): Promise<WorkflowLabCheckpointListResult> {
  assertWorkflowLabEnabled()
  const sourceEpisode = await findSourceEpisode({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.sourceEpisodeId,
  })
  const sourceWorkflow = await resolveEditFirstWorkflowState({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: sourceEpisode.id,
  })
  const sourceThread = await loadSourceThread({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: sourceEpisode.id,
  })

  return {
    sourceEpisode: summarizeEpisode(sourceEpisode, sourceWorkflow),
    checkpoints: sourceThread
      ? listWorkflowLabCheckpointsFromMessages({
        sourceEpisodeId: sourceEpisode.id,
        messages: sourceThread.messages,
      })
      : [],
  }
}

function mapEpisodeId(params: {
  readonly maps: WorkflowLabCloneMaps
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
}) {
  mapWorkflowLabId({
    maps: params.maps,
    scopedMap: params.maps.allIds,
    sourceId: params.sourceEpisodeId,
    targetId: params.targetEpisodeId,
  })
}

async function createLabChoiceCheckpointState(params: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly checkpoint: WorkflowLabCheckpointSummary
  readonly messages: readonly UIMessage[]
}): Promise<UIMessage[]> {
  if (params.checkpoint.kind !== 'choice' || !params.checkpoint.choiceType) {
    return [...params.messages]
  }
  const checkpointMessage = params.messages[params.checkpoint.messageIndex]
  const checkpointPart = checkpointMessage?.parts[params.checkpoint.partIndex]
  if (!checkpointPart || checkpointPart.type !== 'data-assistant-choice-card') {
    throw new Error('WORKFLOW_LAB_CHOICE_CARD_NOT_FOUND')
  }
  const card = await createLabChoiceState({
    ...params,
    choiceType: params.checkpoint.choiceType,
    operationId: EDIT_FIRST_CHOICE_TOOL_IDS[params.checkpoint.choiceType],
    card: checkpointPart.data as ProjectAgentChoiceCardPartData,
  })
  return params.messages.map((message, messageIndex) => (
    messageIndex !== params.checkpoint.messageIndex
      ? message
      : {
          ...message,
          parts: message.parts.map((part, partIndex) => (
            partIndex !== params.checkpoint.partIndex
              ? part
              : {
                  ...checkpointPart,
                  data: card,
                }
          )),
        }
  ))
}

async function createLabChoiceState(params: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly choiceType: NonNullable<WorkflowLabCheckpointSummary['choiceType']>
  readonly operationId: string
  readonly card: ProjectAgentChoiceCardPartData
}): Promise<ProjectAgentChoiceCardPartData> {
  const runId = crypto.randomUUID()
  const activityId = crypto.randomUUID()
  const requestId = crypto.randomUUID()
  const toolCallId = `workflow-lab:${crypto.randomUUID()}`
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: params.projectId,
    episodeId: params.episodeId,
  })
  const interruptionId = crypto.randomUUID()
  const card: ProjectAgentChoiceCardPartData = {
    ...params.card,
    runId,
    interruptionId,
    toolCallId,
  }
  const runFence = createInitialProjectAgentRunFence(runId)
  const reviewedResource = await resolveCurrentProjectAgentChoiceReviewedResource({
    tx: params.tx,
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    card,
  })
  const offer = buildProjectAgentChoiceOffer({
    runId,
    interruptionId,
    card,
    reviewedResource,
  })
  const baseEvents = [{
    runFence,
    idempotencyKey: `workflow-lab:run-started:${runId}`,
    event: {
      kind: 'run.started' as const,
      runId,
      requestId,
      controlKind: 'user_turn' as const,
    },
  }]
  const choiceEvents = [{
    runFence,
    idempotencyKey: `workflow-lab:interruption-raised:${interruptionId}`,
    event: {
      kind: 'interruption.raised' as const,
      runId,
      activityId,
      interruptionId,
      interruptionKind: 'choice' as const,
      operationId: params.operationId,
      approvalId: `choice:${crypto.randomUUID()}`,
      toolCallId,
      choiceType: params.choiceType,
      payload: serializeWorkflowLabValue(offer),
      runState: null,
    },
  }]

  await appendProjectAgentEventsInTransaction(params.tx, {
    scope: {
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      assistantId: 'workspace-command',
      scopeRef,
    },
    events: [...baseEvents, ...choiceEvents],
  })
  return card
}

async function createLabCheckpointAgentState(params: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly checkpoint: WorkflowLabCheckpointSummary
  readonly messages: readonly UIMessage[]
}): Promise<UIMessage[]> {
  if (params.checkpoint.kind === 'choice') {
    return await createLabChoiceCheckpointState(params)
  }
  return [...params.messages]
}

export async function forkWorkflowLabCheckpointProject(params: {
  readonly projectId: string
  readonly userId: string
  readonly sourceEpisodeId: string
  readonly checkpointId: string
  readonly name?: string | null
}): Promise<WorkflowLabForkResult> {
  assertWorkflowLabEnabled()

  const [sourceProject, sourceEpisode, sourceThread] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: params.projectId,
        userId: params.userId,
      },
    }),
    findSourceEpisode({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.sourceEpisodeId,
    }),
    loadSourceThread({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.sourceEpisodeId,
    }),
  ])

  if (!sourceProject) {
    throw new ApiError('NOT_FOUND', {
      code: 'WORKFLOW_LAB_SOURCE_PROJECT_NOT_FOUND',
      message: 'source project not found',
    })
  }
  if (!sourceThread) {
    throw new ApiError('NOT_FOUND', {
      code: 'WORKFLOW_LAB_SOURCE_ASSISTANT_THREAD_NOT_FOUND',
      message: 'source assistant thread not found',
    })
  }

  const checkpoint = findWorkflowLabCheckpoint({
    sourceEpisodeId: sourceEpisode.id,
    messages: sourceThread.messages,
    checkpointId: params.checkpointId,
  })
  if (!checkpoint) {
    throw new ApiError('NOT_FOUND', {
      code: 'WORKFLOW_LAB_CHECKPOINT_NOT_FOUND',
      message: 'workflow lab checkpoint not found',
    })
  }

  const forkName = params.name?.trim() || buildLabProjectName({
    sourceName: sourceProject.name,
    stage: checkpoint.workflowStage,
  })

  const transactionResult = await prisma.$transaction(async (tx) => {
    const maps = createWorkflowLabCloneMaps()
    const labProject = await tx.project.create({
      data: {
        name: forkName,
        description: sourceProject.description,
        userId: params.userId,
        analysisModel: sourceProject.analysisModel,
        imageModel: sourceProject.imageModel,
        videoModel: sourceProject.videoModel,
        singleShotVideoModel: sourceProject.singleShotVideoModel,
        sequenceVideoModel: sourceProject.sequenceVideoModel,
        musicModel: sourceProject.musicModel,
        soundEffectModel: sourceProject.soundEffectModel,
        videoRatio: sourceProject.videoRatio,
        globalAssetText: sourceProject.globalAssetText,
        characterModel: sourceProject.characterModel,
        locationModel: sourceProject.locationModel,
        storyboardModel: sourceProject.storyboardModel,
        editModel: sourceProject.editModel,
        videoResolution: sourceProject.videoResolution,
        capabilityOverrides: sourceProject.capabilityOverrides,
        imageResolution: sourceProject.imageResolution,
      },
      select: {
        id: true,
        name: true,
      },
    })
    maps.allIds.set(sourceProject.id, labProject.id)

    await cloneWorkflowLabProjectAssets({
      tx,
      sourceProjectId: sourceProject.id,
      targetProjectId: labProject.id,
      maps,
    })

    const labEpisode = await tx.projectEpisode.create({
      data: {
        projectId: labProject.id,
        episodeNumber: 1,
        name: sourceEpisode.name,
        description: sourceEpisode.description,
        novelText: sourceEpisode.novelText,
        audioUrl: sourceEpisode.audioUrl,
        audioMediaId: sourceEpisode.audioMediaId,
        srtContent: sourceEpisode.srtContent,
      },
      select: {
        id: true,
        name: true,
        episodeNumber: true,
      },
    })
    await createDefaultEditChapter(labEpisode.id, tx)
    mapEpisodeId({
      maps,
      sourceEpisodeId: sourceEpisode.id,
      targetEpisodeId: labEpisode.id,
    })

    await cloneEpisodeProjectData({
      tx,
      sourceProjectId: sourceProject.id,
      targetProjectId: labProject.id,
      sourceEpisodeId: sourceEpisode.id,
      targetEpisodeId: labEpisode.id,
      stage: checkpoint.workflowStage,
      maps,
    })

    const rawCheckpointMessages = sliceWorkflowLabMessagesAtCheckpoint({
      messages: sourceThread.messages,
      checkpoint,
      includeCheckpointPart: checkpoint.kind === 'choice',
    })
    const rewrittenMessages = rewriteWorkflowLabAssistantMessages({
      messages: rawCheckpointMessages,
      replacements: buildWorkflowLabMessageReplacementMap({
        sourceProjectId: sourceProject.id,
        targetProjectId: labProject.id,
        sourceEpisodeId: sourceEpisode.id,
        targetEpisodeId: labEpisode.id,
        idMap: maps.allIds,
      }),
    })
    const validatedMessages = await validateWorkflowLabMessages(rewrittenMessages)
    const messages = await createLabCheckpointAgentState({
      tx,
      projectId: labProject.id,
      userId: params.userId,
      episodeId: labEpisode.id,
      checkpoint,
      messages: validatedMessages,
    })
    await tx.projectAssistantThread.create({
      data: {
        projectId: labProject.id,
        userId: params.userId,
        episodeId: labEpisode.id,
        assistantId: 'workspace-command',
        scopeRef: buildProjectAssistantScopeRef({
          projectId: labProject.id,
          episodeId: labEpisode.id,
        }),
        messagesJson: serializeWorkflowLabMessages(messages),
      },
    })

    await tx.project.update({
      where: { id: labProject.id },
      data: { lastEpisodeId: labEpisode.id },
    })

    return {
      labProject,
      labEpisode,
    }
  }, {
    timeout: WORKFLOW_LAB_TRANSACTION_TIMEOUT_MS,
  })

  const [sourceWorkflowAfterFork, labWorkflow] = await Promise.all([
    resolveEditFirstWorkflowState({
      projectId: sourceProject.id,
      userId: params.userId,
      episodeId: sourceEpisode.id,
    }),
    resolveEditFirstWorkflowState({
      projectId: transactionResult.labProject.id,
      userId: params.userId,
      episodeId: transactionResult.labEpisode.id,
    }),
  ])

  return {
    checkpoint,
    sourceProject: summarizeProject(sourceProject),
    sourceEpisode: summarizeEpisode(sourceEpisode, sourceWorkflowAfterFork),
    labProject: summarizeProject(transactionResult.labProject),
    labEpisode: summarizeEpisode(transactionResult.labEpisode, labWorkflow),
  }
}
