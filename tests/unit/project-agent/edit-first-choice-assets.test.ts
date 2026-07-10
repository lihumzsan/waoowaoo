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

  it('rejects a style selection without a preview id', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'style',
      toolCallId: null,
      latestUserText: '生成一部民俗恐怖短片',
      output: {
        ok: true,
        aspectRatio: '9:16',
      },
    })).toBeNull()
  })

  it('rejects asset review revision without notes', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: null,
      latestUserText: '继续',
      output: {
        ok: true,
        decision: 'revise',
      },
    })).toBeNull()
  })

  it('persists approved asset review as the user decision without selecting the next operation', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: true,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEpisodeEditScriptAssetsMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
  })

  it('does not persist asset review when the user has not approved assets', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: true,
        decision: 'revise',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEpisodeEditScriptAssetsMock).not.toHaveBeenCalled()
  })

  it('does not persist asset review from a failed choice result', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: false,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEpisodeEditScriptAssetsMock).not.toHaveBeenCalled()
  })
})
