import { describe, expect, it } from 'vitest'
import { buildAssistantProjectContextSnapshot } from '@/lib/project-agent/presentation'
import type { ProjectContextSnapshot } from '@/lib/project-context/types'
import { EDIT_FIRST_WORKFLOW_EMPTY_STATE } from '@/lib/project-workflow/edit-first'

describe('project agent presentation', () => {
  it('builds assistant project context snapshot from policy config', () => {
    const snapshot = buildAssistantProjectContextSnapshot({
      projectId: 'project-1',
      projectName: 'a',
      episodeId: 'episode-1',
      episodeName: '剧集 1',
      selectedScopeRef: null,
      latestArtifacts: [],
      activePlanRuns: [],
      activeOperationTasks: [],
      recentOperationResults: [],
      policy: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        videoRatio: '9:16',
        analysisModel: 'google::gemini-3.1-flash-lite-preview',
        overrides: {},
      },
      editFirstWorkflow: EDIT_FIRST_WORKFLOW_EMPTY_STATE,
    } satisfies ProjectContextSnapshot)

    expect(snapshot.config).toEqual({
      analysisModel: 'google::gemini-3.1-flash-lite-preview',
      videoRatio: '9:16',
    })
    expect(snapshot.editFirstWorkflow).toEqual(EDIT_FIRST_WORKFLOW_EMPTY_STATE)
  })

  it('passes workflow snapshot into assistant context', () => {
    const editFirstWorkflow = {
      ...EDIT_FIRST_WORKFLOW_EMPTY_STATE,
      active: true,
      stage: 'ready_to_generate_assets' as const,
      blocking: {
        kind: 'needs_confirmation' as const,
        reason: null,
      },
      nextAction: {
        id: 'generate_edit_script_assets',
        operationId: 'generate_edit_script_assets' as const,
        title: 'Generate required assets',
        approvalKind: 'billable_media' as const,
        requiresUserConfirmation: true,
      },
      allowedOperationIds: ['generate_edit_script_assets' as const],
    }
    const snapshot = buildAssistantProjectContextSnapshot({
      projectId: 'project-1',
      projectName: 'a',
      episodeId: 'episode-1',
      episodeName: '剧集 1',
      selectedScopeRef: 'clip:clip-1',
      latestArtifacts: [],
      activePlanRuns: [],
      activeOperationTasks: [],
      recentOperationResults: [
        {
          operationId: 'generate_project_music',
          taskId: 'task-1',
          taskType: 'music_generate',
          status: 'completed',
          targetType: 'Project',
          targetId: 'project-1',
          submittedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:01:00.000Z',
          media: {
            mediaType: 'music',
            mediaId: 'media-1',
            url: 'https://audio.example/music.mp3',
          },
        },
      ],
      policy: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        videoRatio: '9:16',
        analysisModel: 'google::gemini-3.1-flash-lite-preview',
        overrides: {},
      },
      editFirstWorkflow,
      episodeDetail: {
        episode: {
          novelText: 'text',
          storyboardCount: 1,
          panelCount: 3,
        },
        editBible: {
          id: 'bible-1',
          status: 'ready',
          userPrompt: 'make a short film',
          textPreview: 'INT. DOCK - NIGHT',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        chapters: [],
        editScripts: [],
        editScript: {
          id: 'edit-1',
          chapterId: 'chapter-1',
          status: 'ready',
          assetReviewStatus: 'pending',
          durationSec: 30,
          shotCount: 6,
          generationSegmentCount: 2,
          requirementCount: 3,
          pendingRequirementCount: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        panels: [
          {
            panelId: 'panel-1',
            editScriptId: null,
            storyboardId: 'storyboard-1',
            panelIndex: 0,
            description: 'panel',
            imagePrompt: null,
            videoPrompt: null,
            imageUrl: null,
            imageMediaId: null,
            candidateImages: null,
            videoUrl: null,
            videoMediaId: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    } satisfies ProjectContextSnapshot)

    expect(snapshot.editFirstWorkflow).toEqual(editFirstWorkflow)
    expect(snapshot.editBible?.id).toBe('bible-1')
    expect(snapshot.editScript?.generationSegmentCount).toBe(2)
    expect(snapshot.recentOperationResults[0]?.media?.url).toBe('https://audio.example/music.mp3')
  })

})
