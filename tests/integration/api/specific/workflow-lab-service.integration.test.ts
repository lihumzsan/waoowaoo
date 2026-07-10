import { Prisma } from '@prisma/client'
import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSystemState } from '../../../helpers/db-reset'
import {
  createFixtureEpisode,
  createFixtureProject,
  createFixtureUser,
} from '../../../helpers/fixtures'
import { prisma } from '../../../helpers/prisma'
import { buildProjectAssistantScopeRef } from '@/lib/project-agent/persistence'
import { getProjectAgentSessionState } from '@/lib/project-agent/session-state'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'
import {
  forkWorkflowLabCheckpointProject,
  listWorkflowLabCheckpoints,
} from '@/lib/workflow-lab/service'

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function readJsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EXPECTED_JSON_OBJECT')
  }
  return value as Record<string, Prisma.JsonValue>
}

async function createBibleReviewSource(params: {
  messages: (scope: { projectId: string; episodeId: string }) => UIMessage[]
}) {
  const user = await createFixtureUser()
  const project = await createFixtureProject(user.id)
  const episode = await createFixtureEpisode(project.id)
  const sourceDocument = await prisma.projectEpisodeSourceDocument.create({
    data: {
      episodeId: episode.id,
      normalizedText: 'A complete source script for workflow lab testing.',
      checksum: 'a'.repeat(64),
      sourceKind: 'uploaded_script',
      version: 1,
    },
  })
  await prisma.projectEditBible.create({
    data: {
      episodeId: episode.id,
      sourceDocumentId: sourceDocument.id,
      bibleJson: { title: 'Workflow Lab' } satisfies Prisma.InputJsonObject,
      beatSheetJson: { beats: [] } satisfies Prisma.InputJsonObject,
      ledgerJson: { facts: [] } satisfies Prisma.InputJsonObject,
      emotionalCurveJson: { points: [] } satisfies Prisma.InputJsonObject,
      styleBibleJson: { tone: 'cinematic' } satisfies Prisma.InputJsonObject,
      version: 1,
      status: 'ready_for_review',
    },
  })
  const messages = params.messages({
    projectId: project.id,
    episodeId: episode.id,
  })
  await prisma.projectAssistantThread.create({
    data: {
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      scopeRef: buildProjectAssistantScopeRef({
        projectId: project.id,
        episodeId: episode.id,
      }),
      messagesJson: toInputJson(messages),
    },
  })
  return { user, project, episode }
}

function buildBibleReviewChoiceMessages(scope: {
  projectId: string
  episodeId: string
}): UIMessage[] {
  const card: ProjectAgentChoiceCardPartData = {
    cardId: `edit-first-bible-review:${scope.episodeId}`,
    runId: 'source-run',
    interruptionId: 'source-interruption',
    toolCallId: 'source-tool-call',
    choiceType: 'bible_review',
    variant: 'confirm_or_reply',
    title: 'Confirm production plan',
    description: 'Review the production plan.',
    groups: [{
      key: 'aspectRatio',
      label: 'Aspect ratio',
      required: true,
      options: [{ value: '9:16', label: '9:16' }],
    }],
    submitLabel: 'Confirm',
    submit: { kind: 'submit_tool_output' },
    replyLabel: 'Request changes',
    replyToolOutputKey: 'revisionNotes',
  }
  return [{
    id: 'user-message',
    role: 'user',
    parts: [{ type: 'text', text: 'Review the plan.' }],
  }, {
    id: 'assistant-choice',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Please confirm the production plan.' },
      { type: 'data-assistant-choice-card', data: card },
    ],
  }]
}

function buildApprovalMessages(): UIMessage[] {
  return [{
    id: 'user-message',
    role: 'user',
    parts: [{ type: 'text', text: 'Continue.' }],
  }, {
    id: 'assistant-approval',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Style preview generation requires approval.' },
      {
        type: 'data-agent-interruption',
        data: {
          runId: 'source-run',
          requestId: 'source-request',
          interruptionId: 'source-interruption',
          approvalId: 'source-approval',
          operationId: 'generate_edit_style_previews',
          toolCallId: 'source-tool-call',
          inputHash: 'source-input-hash',
          display: {
            title: 'Generate style previews',
            description: 'Generate candidate style previews.',
          },
        },
      },
    ],
  }]
}

describe('workflow lab service runtime restoration', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  it('projects a bible-review choice through events and gives the persisted card the target runtime identity', async () => {
    const source = await createBibleReviewSource({ messages: buildBibleReviewChoiceMessages })
    const listed = await listWorkflowLabCheckpoints({
      projectId: source.project.id,
      userId: source.user.id,
      sourceEpisodeId: source.episode.id,
    })
    const checkpoint = listed.checkpoints.find((candidate) => candidate.kind === 'choice')
    if (!checkpoint) throw new Error('EXPECTED_CHOICE_CHECKPOINT')

    const result = await forkWorkflowLabCheckpointProject({
      projectId: source.project.id,
      userId: source.user.id,
      sourceEpisodeId: source.episode.id,
      checkpointId: checkpoint.id,
    })

    const [run, activity, interruption, events, thread] = await Promise.all([
      prisma.projectAgentRun.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentActivity.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentInterruption.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentEvent.findMany({
        where: { projectId: result.labProject.id },
        orderBy: { id: 'asc' },
      }),
      prisma.projectAssistantThread.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
    ])
    expect(events.map((event) => event.kind)).toEqual(['run.started', 'interruption.raised'])
    expect(run).toMatchObject({ status: 'awaiting_choice', stopReason: 'awaiting_choice' })
    expect(activity).toMatchObject({
      runId: run.id,
      status: 'waiting',
      type: 'awaiting_choice',
      operationId: 'request_edit_bible_review_choice',
      choiceType: 'bible_review',
    })
    expect(interruption).toMatchObject({
      runId: run.id,
      activityId: activity.id,
      status: 'pending',
      type: 'choice',
      operationId: 'request_edit_bible_review_choice',
      toolCallId: activity.toolCallId,
    })

    const payloadCard = readJsonObject(readJsonObject(interruption.payload).card ?? null)
    expect(payloadCard).toMatchObject({
      runId: run.id,
      interruptionId: interruption.id,
      toolCallId: activity.toolCallId,
      choiceType: 'bible_review',
    })
    expect(String(payloadCard.cardId)).toContain(result.labEpisode.id)
    expect(String(payloadCard.cardId)).not.toContain(source.episode.id)

    const persistedMessages = thread.messagesJson as unknown as UIMessage[]
    const persistedPart = persistedMessages[1]?.parts[1]
    if (!persistedPart || persistedPart.type !== 'data-assistant-choice-card') {
      throw new Error('EXPECTED_PERSISTED_CHOICE_CARD')
    }
    expect(persistedPart.data).toMatchObject({
      runId: run.id,
      interruptionId: interruption.id,
      toolCallId: activity.toolCallId,
      cardId: payloadCard.cardId,
    })

    const session = await getProjectAgentSessionState({
      projectId: result.labProject.id,
      userId: source.user.id,
      episodeId: result.labEpisode.id,
      locale: 'en',
    })
    expect(session.pendingInteraction).toMatchObject({
      kind: 'choice',
      runId: run.id,
      interruptionId: interruption.id,
      toolCallId: activity.toolCallId,
      choiceCard: {
        runId: run.id,
        interruptionId: interruption.id,
        toolCallId: activity.toolCallId,
      },
    })
  })

  it('restores an approval checkpoint as a business snapshot without a fake assistant runtime', async () => {
    const source = await createBibleReviewSource({ messages: buildApprovalMessages })
    const listed = await listWorkflowLabCheckpoints({
      projectId: source.project.id,
      userId: source.user.id,
      sourceEpisodeId: source.episode.id,
    })
    const checkpoint = listed.checkpoints.find((candidate) => candidate.kind === 'approval')
    if (!checkpoint) throw new Error('EXPECTED_APPROVAL_CHECKPOINT')

    const result = await forkWorkflowLabCheckpointProject({
      projectId: source.project.id,
      userId: source.user.id,
      sourceEpisodeId: source.episode.id,
      checkpointId: checkpoint.id,
    })

    const [runCount, activityCount, interruptionCount, eventCount, thread, session] = await Promise.all([
      prisma.projectAgentRun.count({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentActivity.count({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentInterruption.count({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentEvent.count({ where: { projectId: result.labProject.id } }),
      prisma.projectAssistantThread.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
      getProjectAgentSessionState({
        projectId: result.labProject.id,
        userId: source.user.id,
        episodeId: result.labEpisode.id,
        locale: 'en',
      }),
    ])
    expect({ runCount, activityCount, interruptionCount, eventCount }).toEqual({
      runCount: 0,
      activityCount: 0,
      interruptionCount: 0,
      eventCount: 0,
    })
    expect(session).toMatchObject({
      currentRun: null,
      currentActivity: null,
      pendingInteraction: null,
    })
    expect(session.editFirstWorkflow.stage).toBe('bible_ready_for_review')

    const persistedMessages = thread.messagesJson as unknown as UIMessage[]
    expect(persistedMessages[1]?.parts.map((part) => part.type)).toEqual(['text'])
  })
})
