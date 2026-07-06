import { Prisma } from '@prisma/client'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { createDefaultEditChapter } from '@/lib/edit-chapter'
import { buildProjectAssistantScopeRef, loadProjectAssistantThread } from '@/lib/project-agent/persistence'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
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
}): Promise<void> {
  if (params.checkpoint.kind !== 'choice' || !params.checkpoint.choiceType) return
  await createLabChoiceState({
    ...params,
    choiceType: params.checkpoint.choiceType,
    operationId: EDIT_FIRST_CHOICE_TOOL_IDS[params.checkpoint.choiceType],
    cardId: params.checkpoint.id,
  })
}

async function createLabRun(params: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly status: 'awaiting_choice' | 'awaiting_approval'
  readonly stopReason: string
}): Promise<{ readonly id: string; readonly scopeRef: string }> {
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: params.projectId,
    episodeId: params.episodeId,
  })
  return await params.tx.projectAgentRun.create({
    data: {
      projectId: params.projectId,
      userId: params.userId,
      assistantId: 'workspace-command',
      scopeRef,
      episodeId: params.episodeId,
      requestId: crypto.randomUUID(),
      status: params.status,
      controlKind: 'user_turn',
      stopReason: params.stopReason,
    },
    select: {
      id: true,
      scopeRef: true,
    },
  })
}

async function createLabChoiceState(params: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly choiceType: NonNullable<WorkflowLabCheckpointSummary['choiceType']>
  readonly operationId: string
  readonly cardId: string
}): Promise<void> {
  const run = await createLabRun({
    ...params,
    status: 'awaiting_choice',
    stopReason: 'awaiting_choice',
  })
  const activity = await params.tx.projectAgentActivity.create({
    data: {
      runId: run.id,
      projectId: params.projectId,
      userId: params.userId,
      assistantId: 'workspace-command',
      scopeRef: run.scopeRef,
      episodeId: params.episodeId,
      type: 'awaiting_choice',
      status: 'waiting',
      operationId: params.choiceType === 'style' ? null : params.operationId,
      sourceOperationId: params.choiceType === 'style' ? 'generate_edit_style_previews' : null,
      choiceType: params.choiceType,
      toolCallId: `workflow-lab:${crypto.randomUUID()}`,
    },
    select: {
      id: true,
      toolCallId: true,
    },
  })
  if (params.choiceType === 'style') return

  await params.tx.projectAgentInterruption.create({
    data: {
      runId: run.id,
      activityId: activity.id,
      projectId: params.projectId,
      userId: params.userId,
      assistantId: 'workspace-command',
      scopeRef: run.scopeRef,
      episodeId: params.episodeId,
      type: 'choice',
      status: 'pending',
      operationId: params.operationId,
      approvalId: `choice:${crypto.randomUUID()}`,
      toolCallId: activity.toolCallId,
      payload: {
        choiceType: params.choiceType,
        cardId: params.cardId,
      } satisfies Prisma.InputJsonObject,
      runState: null,
    },
  })
}

async function createLabApprovalState(params: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly operationId: string
}): Promise<void> {
  const run = await createLabRun({
    ...params,
    status: 'awaiting_approval',
    stopReason: 'awaiting_approval',
  })
  const activity = await params.tx.projectAgentActivity.create({
    data: {
      runId: run.id,
      projectId: params.projectId,
      userId: params.userId,
      assistantId: 'workspace-command',
      scopeRef: run.scopeRef,
      episodeId: params.episodeId,
      type: 'awaiting_approval',
      status: 'waiting',
      operationId: params.operationId,
      toolCallId: `workflow-lab:${crypto.randomUUID()}`,
    },
    select: {
      id: true,
      toolCallId: true,
    },
  })
  await params.tx.projectAgentInterruption.create({
    data: {
      runId: run.id,
      activityId: activity.id,
      projectId: params.projectId,
      userId: params.userId,
      assistantId: 'workspace-command',
      scopeRef: run.scopeRef,
      episodeId: params.episodeId,
      type: 'approval',
      status: 'pending',
      operationId: params.operationId,
      approvalId: `approval:${crypto.randomUUID()}`,
      toolCallId: activity.toolCallId,
      payload: {} satisfies Prisma.InputJsonObject,
      runState: null,
    },
  })
}

async function createLabCheckpointAgentState(params: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly checkpoint: WorkflowLabCheckpointSummary
}): Promise<void> {
  if (params.checkpoint.kind === 'choice') {
    await createLabChoiceCheckpointState(params)
    return
  }
  if (params.checkpoint.kind === 'approval' && params.checkpoint.operationId) {
    await createLabApprovalState({
      ...params,
      operationId: params.checkpoint.operationId,
    })
  }
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
    const messages = await validateWorkflowLabMessages(rewrittenMessages)
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
    await createLabCheckpointAgentState({
      tx,
      projectId: labProject.id,
      userId: params.userId,
      episodeId: labEpisode.id,
      checkpoint,
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
