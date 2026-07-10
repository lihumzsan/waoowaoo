import {
  applyEditFirstChoiceResultSideEffects,
  approveEpisodePromptGeneratedScriptMock,
  approveProjectEpisodeEditScriptAssetsMock,
  beforeEach,
  buildEditFirstChoiceResult,
  confirmEpisodeEditBibleMock,
  describe,
  expect,
  it,
  prismaMock,
} from './edit-first-choice-result.fixture'

describe('buildEditFirstChoiceResult', () => {
  beforeEach(() => {
    approveProjectEpisodeEditScriptAssetsMock.mockClear()
    approveEpisodePromptGeneratedScriptMock.mockClear()
    confirmEpisodeEditBibleMock.mockClear()
    prismaMock.project.updateMany.mockClear()
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 })
  })

  it('persists approved bible review without submitting billable visual-style tasks', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'bible_review',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          aspectRatio: '21:9',
        },
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'user-1',
      },
      data: {
        videoRatio: '21:9',
      },
    })
    expect(confirmEpisodeEditBibleMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
  })

  it('persists approved script review as an explicit script approval edge', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'script_review',
      output: {
        ok: true,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveEpisodePromptGeneratedScriptMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
  })

  it('does not approve script review when the user requests revision', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'script_review',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '换一个结局',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveEpisodePromptGeneratedScriptMock).not.toHaveBeenCalled()
  })

  it('rejects bible approval without a selected aspect ratio', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '确认',
      output: {
        ok: true,
        decision: 'approve',
      },
    })).toBeNull()
  })

  it('does not confirm bible review when approval is missing the selected aspect ratio', async () => {
    await expect(applyEditFirstChoiceResultSideEffects({
      choiceType: 'bible_review',
      output: {
        ok: true,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })).rejects.toThrow('PROJECT_AGENT_BIBLE_REVIEW_ASPECT_RATIO_REQUIRED')

    expect(prismaMock.project.updateMany).not.toHaveBeenCalled()
    expect(confirmEpisodeEditBibleMock).not.toHaveBeenCalled()
  })

  it('rejects a bible review without a decision', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
      },
    })).toBeNull()
  })
})
