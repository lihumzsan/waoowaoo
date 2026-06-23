import { Prisma } from '@prisma/client'
import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSystemState } from '../../helpers/db-reset'
import {
  createFixtureEpisode,
  createFixtureProject,
  createFixtureUser,
} from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'
import { buildProjectAssistantScopeRef } from '@/lib/project-agent/persistence'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'
import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
import {
  forkWorkflowLabCheckpointProject,
  listWorkflowLabCheckpoints,
} from '@/lib/workflow-lab/service'
import { resolveEditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

function buildStyleChoiceMessages(params: {
  readonly projectId: string
  readonly episodeId: string
  readonly screenplayId: string
  readonly firstPreviewId: string
  readonly secondPreviewId: string
}): UIMessage[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      parts: [
        {
          type: 'text',
          text: '生成一个测试短片',
        },
      ],
    },
    {
      id: 'assistant-style-choice',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: '请选择视觉风格。',
        },
        {
          type: 'data-assistant-choice-card',
          data: {
            cardId: `edit-first-style:${params.screenplayId}`,
            runId: 'source-run-1',
            interruptionId: 'source-interruption-1',
            toolCallId: 'source-tool-call-1',
            choiceType: 'style',
            title: '选择视觉风格',
            description: '请选择一个风格候选。',
            groups: [
              {
                key: 'stylePreviewId',
                label: '视觉风格',
                required: true,
                options: [
                  {
                    value: params.firstPreviewId,
                    label: '候选 1',
                    description: '第一版',
                    imageUrl: 'https://example.test/style-a.png',
                    meta: 'style-a',
                  },
                  {
                    value: params.secondPreviewId,
                    label: '候选 2',
                    description: '第二版',
                    imageUrl: 'https://example.test/style-b.png',
                    meta: 'style-b',
                  },
                ],
              },
            ],
            submitLabel: '确认并继续',
            submit: {
              kind: 'confirm_edit_style_preview',
              projectId: params.projectId,
              episodeId: params.episodeId,
              aspectRatio: '9:16',
            },
          },
        },
      ],
    },
    {
      id: 'assistant-after-choice',
      role: 'assistant',
      parts: [
        {
          type: 'data-assistant-choice-resolved',
          data: {
            runId: 'source-run-1',
            interruptionId: 'source-interruption-1',
            choiceType: 'style',
            toolCallId: 'source-tool-call-1',
            cardId: `edit-first-style:${params.screenplayId}`,
          },
        },
      ],
    },
  ]
}

describe('workflow lab checkpoint project fork integration', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  it('creates an isolated lab project from a real assistant style-choice checkpoint and restores the pending choice', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id, 1)

    const character = await prisma.projectCharacter.create({
      data: {
        projectId: project.id,
        name: 'Mira',
        profileData: 'scientist',
        profileConfirmed: true,
      },
    })
    await prisma.characterAppearance.create({
      data: {
        characterId: character.id,
        appearanceIndex: 0,
        changeReason: 'default',
        imageUrl: 'https://example.test/mira.png',
      },
    })
    const location = await prisma.projectLocation.create({
      data: {
        projectId: project.id,
        name: 'Lab',
        summary: 'A bright lab.',
      },
    })
    const locationImage = await prisma.locationImage.create({
      data: {
        locationId: location.id,
        imageIndex: 0,
        imageUrl: 'https://example.test/lab.png',
        isSelected: true,
        spatialProfileStatus: 'completed',
        spatialProfileJson: { zones: ['bench'] } satisfies Prisma.InputJsonObject,
      },
    })
    await prisma.projectLocation.update({
      where: { id: location.id },
      data: { selectedImageId: locationImage.id },
    })

    const screenplay = await prisma.projectEditScreenplay.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        userPrompt: 'source prompt',
        styleBibleJson: { tone: 'cinematic', palette: 'blue gold' } satisfies Prisma.InputJsonObject,
        screenplayText: 'INT. TEST ROOM - DAY',
        status: 'ready',
      },
    })

    const firstPreview = await prisma.projectEditStylePreview.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        editScreenplayId: screenplay.id,
        styleKey: 'style-a',
        aspectRatio: '9:16',
        title: 'Cool Light',
        summary: 'A cool cinematic palette.',
        styleBibleJson: { lens: '35mm', contrast: 'high' } satisfies Prisma.InputJsonObject,
        imagePrompt: 'cool light frame',
        imageKey: 'style-a-key',
        status: 'confirmed',
      },
    })
    const secondPreview = await prisma.projectEditStylePreview.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        editScreenplayId: screenplay.id,
        styleKey: 'style-b',
        aspectRatio: '9:16',
        title: 'Warm Night',
        summary: 'A warm night palette.',
        styleBibleJson: { lens: '50mm', contrast: 'soft' } satisfies Prisma.InputJsonObject,
        imagePrompt: 'warm night frame',
        imageKey: 'style-b-key',
        status: 'completed',
      },
    })

    await prisma.projectEditDirectorDecoupage.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        editScreenplayId: screenplay.id,
        userPrompt: 'after style',
        decoupageJson: { beats: [] } satisfies Prisma.InputJsonObject,
        status: 'ready',
      },
    })

    await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        episodeId: episode.id,
        assistantId: 'workspace-command',
        scopeRef: buildProjectAssistantScopeRef({ projectId: project.id, episodeId: episode.id }),
        messagesJson: buildStyleChoiceMessages({
          projectId: project.id,
          episodeId: episode.id,
          screenplayId: screenplay.id,
          firstPreviewId: firstPreview.id,
          secondPreviewId: secondPreview.id,
        }) as unknown as Prisma.InputJsonArray,
      },
    })

    const checkpoints = await listWorkflowLabCheckpoints({
      projectId: project.id,
      userId: user.id,
      sourceEpisodeId: episode.id,
    })
    expect(checkpoints.checkpoints).toHaveLength(1)
    expect(checkpoints.checkpoints[0]).toMatchObject({
      kind: 'choice',
      workflowStage: 'needs_style_choice',
      choiceType: 'style',
      assistantMessageCount: 2,
    })

    const result = await forkWorkflowLabCheckpointProject({
      projectId: project.id,
      userId: user.id,
      sourceEpisodeId: episode.id,
      checkpointId: checkpoints.checkpoints[0].id,
    })

    expect(result.labProject.id).not.toBe(project.id)
    expect(result.labProject.name).toContain('[LAB] needs_style_choice -')
    expect(result.labEpisode.id).not.toBe(episode.id)
    expect(result.labEpisode.workflowStage).toBe('needs_style_choice')

    const sourceWorkflow = await resolveEditFirstWorkflowState({
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
    })
    expect(sourceWorkflow.stage).toBe('ready_to_generate_edit_script')

    const labScreenplay = await prisma.projectEditScreenplay.findUniqueOrThrow({
      where: { episodeId: result.labEpisode.id },
      include: {
        stylePreviews: {
          orderBy: { styleKey: 'asc' },
        },
        directorDecoupage: true,
      },
    })
    expect(labScreenplay.projectId).toBe(result.labProject.id)
    expect(labScreenplay.id).not.toBe(screenplay.id)
    expect(labScreenplay.status).toBe('style_preview_ready')
    expect(labScreenplay.directorDecoupage).toBeNull()
    expect(labScreenplay.stylePreviews).toHaveLength(2)
    expect(labScreenplay.stylePreviews[0].id).not.toBe(firstPreview.id)
    expect(labScreenplay.stylePreviews[0].status).toBe('completed')
    expect(labScreenplay.stylePreviews[1].status).toBe('completed')

    const labCharacter = await prisma.projectCharacter.findFirstOrThrow({
      where: { projectId: result.labProject.id, name: 'Mira' },
      include: { appearances: true },
    })
    expect(labCharacter.id).not.toBe(character.id)
    expect(labCharacter.appearances).toHaveLength(1)

    const labLocation = await prisma.projectLocation.findFirstOrThrow({
      where: { projectId: result.labProject.id, name: 'Lab' },
      include: { images: true },
    })
    expect(labLocation.id).not.toBe(location.id)
    expect(labLocation.images).toHaveLength(1)
    expect(labLocation.selectedImageId).toBe(labLocation.images[0].id)

    const labDecoupageCount = await prisma.projectEditDirectorDecoupage.count({
      where: { episodeId: result.labEpisode.id },
    })
    expect(labDecoupageCount).toBe(0)

    const labThread = await prisma.projectAssistantThread.findUniqueOrThrow({
      where: {
        projectId_userId_assistantId_scopeRef: {
          projectId: result.labProject.id,
          userId: user.id,
          assistantId: 'workspace-command',
          scopeRef: buildProjectAssistantScopeRef({
            projectId: result.labProject.id,
            episodeId: result.labEpisode.id,
          }),
        },
      },
    })
    const labMessages = labThread.messagesJson as unknown as UIMessage[]
    expect(labMessages).toHaveLength(2)
    const cardPart = labMessages[1]?.parts[1]
    expect(cardPart?.type).toBe('data-assistant-choice-card')
    const cardData = cardPart?.type === 'data-assistant-choice-card'
      ? cardPart.data as ProjectAgentChoiceCardPartData
      : null
    expect(cardData?.submit).toMatchObject({
      projectId: result.labProject.id,
      episodeId: result.labEpisode.id,
    })
    expect(cardData?.cardId).toBe(`edit-first-style:${labScreenplay.id}`)
    expect(cardData?.groups[0]?.options.map((option) => option.value)).toEqual(
      labScreenplay.stylePreviews.map((preview) => preview.id),
    )

    const pendingChoice = await prisma.projectAgentInterruption.findFirstOrThrow({
      where: {
        projectId: result.labProject.id,
        userId: user.id,
        episodeId: result.labEpisode.id,
        type: 'choice',
        status: 'pending',
      },
    })
    expect(pendingChoice.operationId).toBe(EDIT_FIRST_CHOICE_TOOL_IDS.style)
    expect(pendingChoice.payload).toMatchObject({
      choiceType: 'style',
    })
  })

  it('rejects checkpoint forks when the source assistant thread is missing', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id, 1)

    await expect(forkWorkflowLabCheckpointProject({
      projectId: project.id,
      userId: user.id,
      sourceEpisodeId: episode.id,
      checkpointId: 'choice:1:0:missing',
    })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: expect.objectContaining({
        code: 'WORKFLOW_LAB_SOURCE_ASSISTANT_THREAD_NOT_FOUND',
      }),
    })

    const projectCount = await prisma.project.count({
      where: {
        userId: user.id,
        name: {
          startsWith: '[LAB]',
        },
      },
    })
    expect(projectCount).toBe(0)
  })
})
