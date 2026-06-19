import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSystemState } from '../../helpers/db-reset'
import {
  createFixtureEpisode,
  createFixtureProject,
  createFixtureUser,
} from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'
import { buildProjectAssistantScopeRef } from '@/lib/project-agent/persistence'
import { forkWorkflowLabEpisode, listWorkflowLabEpisodes } from '@/lib/workflow-lab/service'

describe('workflow lab fork integration', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  it('forks a stable style-choice checkpoint without copying assistant conversation state', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id, 1)

    const screenplay = await prisma.projectEditScreenplay.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        userPrompt: 'source prompt',
        styleBibleJson: { tone: 'cinematic', palette: 'blue gold' } satisfies Prisma.InputJsonObject,
        screenplayText: 'INT. TEST ROOM - DAY',
        status: 'style_preview_ready',
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
        status: 'completed',
      },
    })
    await prisma.projectEditStylePreview.create({
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

    const clip = await prisma.projectClip.create({
      data: {
        episodeId: episode.id,
        summary: 'source clip',
        content: 'source clip content',
        location: 'Lab',
        characters: 'Mira',
        screenplay: 'INT. TEST ROOM - DAY',
      },
    })
    const storyboard = await prisma.projectStoryboard.create({
      data: {
        episodeId: episode.id,
        clipId: clip.id,
        panelCount: 1,
        storyboardTextJson: JSON.stringify([{ panel: 1, text: 'Mira enters.' }]),
        photographyPlan: JSON.stringify({ currentStage: 'blocking_ready' }),
      },
    })
    const panel = await prisma.projectPanel.create({
      data: {
        storyboardId: storyboard.id,
        panelIndex: 0,
        panelNumber: 1,
        description: 'Mira enters the lab.',
        imagePrompt: 'Mira entering a lab',
        imageUrl: 'https://example.test/panel.png',
        lastVideoGenerationOptions: { duration: 4 } satisfies Prisma.InputJsonObject,
      },
    })
    await prisma.supplementaryPanel.create({
      data: {
        storyboardId: storyboard.id,
        sourceType: 'panel',
        sourcePanelId: panel.id,
        description: 'Extra angle',
        imagePrompt: 'Mira from side angle',
        imageUrl: 'https://example.test/supplementary.png',
      },
    })
    await prisma.projectStoryboardBlockingArtifact.create({
      data: {
        storyboardId: storyboard.id,
        kind: 'spatial_reference',
        sourceVideoBlockId: 'video-block-1',
        groupIndex: 0,
        prompt: 'block the scene',
        imageUrl: 'https://example.test/blocking.png',
        metadataJson: { source: 'test' } satisfies Prisma.InputJsonObject,
        status: 'completed',
      },
    })
    await prisma.videoEditorProject.create({
      data: {
        episodeId: episode.id,
        projectData: JSON.stringify({ tracks: [] }),
        renderStatus: 'completed',
        outputUrl: 'https://example.test/final.mp4',
      },
    })
    await prisma.projectVideoGroup.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        gridMode: 'single',
        shotNumbers: [1] satisfies Prisma.InputJsonArray,
        durationSec: 4,
        prompt: 'video group prompt',
        status: 'completed',
        videoUrl: 'https://example.test/group.mp4',
      },
    })

    await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        episodeId: episode.id,
        assistantId: 'workspace-command',
        scopeRef: buildProjectAssistantScopeRef({ projectId: project.id, episodeId: episode.id }),
        messagesJson: [] satisfies Prisma.InputJsonArray,
      },
    })

    const result = await forkWorkflowLabEpisode({
      projectId: project.id,
      userId: user.id,
      sourceEpisodeId: episode.id,
    })

    expect(result.sourceEpisode.workflowStage).toBe('needs_style_choice')
    expect(result.sourceEpisode.blockingKind).toBe('needs_user_choice')
    expect(result.sourceEpisode.allowedOperationIds).toEqual(['generate_edit_style_previews'])
    expect(result.forkedEpisode.workflowStage).toBe('needs_style_choice')
    expect(result.forkedEpisode.id).not.toBe(episode.id)
    expect(result.forkedEpisode.name).toContain('[LAB] needs_style_choice - Episode 1 -')

    const updatedProject = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { lastEpisodeId: true },
    })
    expect(updatedProject.lastEpisodeId).toBe(result.forkedEpisode.id)

    const copiedScreenplay = await prisma.projectEditScreenplay.findUniqueOrThrow({
      where: { episodeId: result.forkedEpisode.id },
      include: {
        stylePreviews: {
          orderBy: { styleKey: 'asc' },
        },
      },
    })
    expect(copiedScreenplay.id).not.toBe(screenplay.id)
    expect(copiedScreenplay.status).toBe('style_preview_ready')
    expect(copiedScreenplay.screenplayText).toBe('INT. TEST ROOM - DAY')
    expect(copiedScreenplay.stylePreviews).toHaveLength(2)
    expect(copiedScreenplay.stylePreviews[0].id).not.toBe(firstPreview.id)
    expect(copiedScreenplay.stylePreviews[0].editScreenplayId).toBe(copiedScreenplay.id)
    expect(copiedScreenplay.stylePreviews[0].styleKey).toBe('style-a')
    expect(copiedScreenplay.stylePreviews[0].status).toBe('completed')

    const copiedStoryboard = await prisma.projectStoryboard.findFirstOrThrow({
      where: { episodeId: result.forkedEpisode.id },
      include: {
        clip: true,
        panels: {
          orderBy: { panelIndex: 'asc' },
        },
        supplementaryPanels: true,
        blockingArtifacts: true,
      },
    })
    expect(copiedStoryboard.id).not.toBe(storyboard.id)
    expect(copiedStoryboard.clipId).not.toBe(clip.id)
    expect(copiedStoryboard.clip.summary).toBe('source clip')
    expect(copiedStoryboard.panels).toHaveLength(1)
    expect(copiedStoryboard.panels[0].id).not.toBe(panel.id)
    expect(copiedStoryboard.panels[0].description).toBe('Mira enters the lab.')
    expect(copiedStoryboard.supplementaryPanels).toHaveLength(1)
    expect(copiedStoryboard.supplementaryPanels[0].sourcePanelId).toBe(copiedStoryboard.panels[0].id)
    expect(copiedStoryboard.blockingArtifacts).toHaveLength(1)
    expect(copiedStoryboard.blockingArtifacts[0].sourceVideoBlockId).toBe('video-block-1')

    const copiedEditorProject = await prisma.videoEditorProject.findUniqueOrThrow({
      where: { episodeId: result.forkedEpisode.id },
    })
    expect(copiedEditorProject.outputUrl).toBe('https://example.test/final.mp4')

    const copiedVideoGroup = await prisma.projectVideoGroup.findFirstOrThrow({
      where: { episodeId: result.forkedEpisode.id },
    })
    expect(copiedVideoGroup.shotNumbers).toEqual([1])
    expect(copiedVideoGroup.videoUrl).toBe('https://example.test/group.mp4')

    const forkedAssistantThreadCount = await prisma.projectAssistantThread.count({
      where: {
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
        scopeRef: buildProjectAssistantScopeRef({
          projectId: project.id,
          episodeId: result.forkedEpisode.id,
        }),
      },
    })
    expect(forkedAssistantThreadCount).toBe(0)

    const summaries = await listWorkflowLabEpisodes({
      projectId: project.id,
      userId: user.id,
    })
    expect(summaries.map((summary) => ({
      id: summary.id,
      workflowStage: summary.workflowStage,
      blockingKind: summary.blockingKind,
    }))).toEqual([
      {
        id: episode.id,
        workflowStage: 'needs_style_choice',
        blockingKind: 'needs_user_choice',
      },
      {
        id: result.forkedEpisode.id,
        workflowStage: 'needs_style_choice',
        blockingKind: 'needs_user_choice',
      },
    ])
  })

  it('rejects processing checkpoints instead of creating an unreal fork with orphaned active work', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id, 1)

    await prisma.projectEditScreenplay.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        userPrompt: 'source prompt',
        styleBibleJson: Prisma.JsonNull,
        screenplayText: 'INT. TEST ROOM - DAY',
        status: 'style_preview_generating',
      },
    })

    await expect(forkWorkflowLabEpisode({
      projectId: project.id,
      userId: user.id,
      sourceEpisodeId: episode.id,
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'WORKFLOW_LAB_PROCESSING_SOURCE_NOT_FORKABLE',
      }),
    })

    const episodeCount = await prisma.projectEpisode.count({
      where: { projectId: project.id },
    })
    expect(episodeCount).toBe(1)
  })
})
