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

describe('workflow lab style-choice restoration', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  it('persists the same target Run identity used by the event-projected style activity', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id)
    const sourceDocument = await prisma.projectEpisodeSourceDocument.create({
      data: {
        episodeId: episode.id,
        normalizedText: 'A source script with a confirmed production plan.',
        checksum: 'b'.repeat(64),
        sourceKind: 'uploaded_script',
        version: 1,
      },
    })
    const bible = await prisma.projectEditBible.create({
      data: {
        episodeId: episode.id,
        sourceDocumentId: sourceDocument.id,
        bibleJson: { title: 'Style test' } satisfies Prisma.InputJsonObject,
        styleBibleJson: { tone: 'cinematic' } satisfies Prisma.InputJsonObject,
        version: 1,
        status: 'confirmed',
      },
    })
    const preview = await prisma.projectEditStylePreview.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        editBibleId: bible.id,
        styleKey: 'style_a',
        aspectRatio: '9:16',
        title: 'Cinematic',
        summary: 'A cinematic style.',
        styleBibleJson: { tone: 'cinematic' } satisfies Prisma.InputJsonObject,
        imagePrompt: 'cinematic frame',
        imageKey: 'style-a-key',
        status: 'completed',
      },
    })
    const card: ProjectAgentChoiceCardPartData = {
      cardId: `edit-first-style:${bible.id}`,
      runId: 'source-run',
      interruptionId: 'source-interruption',
      toolCallId: 'source-tool-call',
      choiceType: 'style',
      title: 'Choose a style',
      groups: [{
        key: 'stylePreviewId',
        label: 'Style',
        required: true,
        options: [{ value: preview.id, label: preview.title }],
      }],
      submitLabel: 'Confirm',
      submit: {
        kind: 'confirm_edit_style_preview',
        projectId: project.id,
        episodeId: episode.id,
        aspectRatio: '9:16',
      },
    }
    const messages: UIMessage[] = [{
      id: 'user-message',
      role: 'user',
      parts: [{ type: 'text', text: 'Choose a style.' }],
    }, {
      id: 'assistant-choice',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Choose a style preview.' },
        { type: 'data-assistant-choice-card', data: card },
      ],
    }]
    await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        episodeId: episode.id,
        assistantId: 'workspace-command',
        scopeRef: buildProjectAssistantScopeRef({ projectId: project.id, episodeId: episode.id }),
        messagesJson: toInputJson(messages),
      },
    })

    const listed = await listWorkflowLabCheckpoints({
      projectId: project.id,
      userId: user.id,
      sourceEpisodeId: episode.id,
    })
    const checkpoint = listed.checkpoints.find((candidate) => candidate.kind === 'choice')
    if (!checkpoint) throw new Error('EXPECTED_STYLE_CHOICE_CHECKPOINT')
    const result = await forkWorkflowLabCheckpointProject({
      projectId: project.id,
      userId: user.id,
      sourceEpisodeId: episode.id,
      checkpointId: checkpoint.id,
    })

    const [run, activity, interruptionCount, events, thread, targetPreview] = await Promise.all([
      prisma.projectAgentRun.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentActivity.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentInterruption.count({ where: { projectId: result.labProject.id } }),
      prisma.projectAgentEvent.findMany({
        where: { projectId: result.labProject.id },
        orderBy: { id: 'asc' },
      }),
      prisma.projectAssistantThread.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
      prisma.projectEditStylePreview.findFirstOrThrow({ where: { projectId: result.labProject.id } }),
    ])
    expect(events.map((event) => event.kind)).toEqual(['run.started', 'activity.started'])
    expect(interruptionCount).toBe(0)
    expect(run).toMatchObject({ status: 'awaiting_choice', stopReason: 'awaiting_choice' })
    expect(activity).toMatchObject({
      runId: run.id,
      status: 'waiting',
      type: 'awaiting_choice',
      operationId: null,
      sourceOperationId: 'generate_edit_style_previews',
      choiceType: 'style',
    })

    const persistedMessages = thread.messagesJson as unknown as UIMessage[]
    const persistedPart = persistedMessages[1]?.parts[1]
    if (!persistedPart || persistedPart.type !== 'data-assistant-choice-card') {
      throw new Error('EXPECTED_PERSISTED_STYLE_CARD')
    }
    const persistedCard = persistedPart.data as ProjectAgentChoiceCardPartData
    expect(persistedCard).toMatchObject({
      runId: run.id,
      interruptionId: null,
      toolCallId: activity.toolCallId,
      submit: {
        projectId: result.labProject.id,
        episodeId: result.labEpisode.id,
      },
    })
    expect(persistedCard.groups[0]?.options[0]?.value).toBe(targetPreview.id)

    const session = await getProjectAgentSessionState({
      projectId: result.labProject.id,
      userId: user.id,
      episodeId: result.labEpisode.id,
      locale: 'en',
    })
    expect(session.pendingInteraction).toBeNull()
    expect(session.activeStylePreviewGeneration?.data.agentRunId).toBe(run.id)
  })
})
