import {
  TASK_TYPE,
  aiMock,
  beforeEach,
  buildJob,
  describe,
  editBibleMock,
  expect,
  handleEditBibleGenerateTask,
  it,
  sourceDocumentMock,
  vi,
} from './edit-bible-generate.fixture'

describe('worker edit-bible-generate behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sourceDocumentMock.readEpisodeSourceDocumentById.mockResolvedValue({
      id: 'source-1',
      episodeId: 'episode-1',
      normalizedText: '0123456789',
      checksum: 'checksum-1',
      sourceKind: 'paste',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })
    sourceDocumentMock.materializePromptGeneratedSourceDocument.mockResolvedValue({
      id: 'source-1',
      episodeId: 'episode-1',
      normalizedText: '扩写后的完整剧本',
      checksum: 'checksum-expanded',
      sourceKind: 'prompt_generated_script',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 2,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:01:00Z'),
      estimatedInputTokens: 120,
    })
    aiMock.executeAiStructuredTextStep.mockResolvedValue({
      text: '扩写后的完整剧本',
      data: aiMock.expandedScriptOutput,
      reasoning: '',
      usage: null,
      completion: null,
    })
    editBibleMock.generateEditBibleArtifacts.mockResolvedValue({
      bible: {
        synopsis: '故事梗概',
        characters: [],
        locations: [],
        worldRules: [],
        styleGuide: {},
      },
      beatSheet: {
        beats: [{
          beatId: 'beat-1',
          title: '开场',
          summary: '主角进入。',
          sourceStart: 0,
          sourceEnd: 10,
          estimatedDurationSec: 60,
        }],
      },
      ledger: { events: [] },
      emotionalCurve: { cues: [] },
    })
  })

  it('expands prompt_generated_outline into a reviewable script without generating the bible', async () => {
    sourceDocumentMock.readEpisodeSourceDocumentById.mockResolvedValueOnce({
      id: 'source-1',
      episodeId: 'episode-1',
      normalizedText: '两分钟民科超光速短片',
      checksum: 'checksum-prompt',
      sourceKind: 'prompt_generated_outline',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })

    const result = await handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }, TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE))

    expect(aiMock.executeAiStructuredTextStep).toHaveBeenCalledWith(expect.objectContaining({
      action: 'outline-script',
      model: 'analysis-model',
      projectId: 'project-1',
      userId: 'user-1',
      meta: expect.objectContaining({
        stepId: 'outline-script',
      }),
    }))
    expect(sourceDocumentMock.materializePromptGeneratedSourceDocument).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      text: '场景一：地下实验室。林启动超光速装置。',
      scriptStructure: expect.objectContaining({ title: '民科超光速' }),
    })
    expect(editBibleMock.markEditBibleScriptReadyForReview).toHaveBeenCalledWith({
      editBibleId: 'bible-1',
      sourceDocumentId: 'source-1',
      taskId: 'task-bible-1',
    })
    expect(editBibleMock.generateEditBibleArtifacts).not.toHaveBeenCalled()
    expect(editBibleMock.persistGeneratedEditBibleBundle).not.toHaveBeenCalled()
    expect(result).toEqual({
      editBibleId: 'bible-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      status: 'script_ready_for_review',
      chapterCount: 0,
      version: null,
    })
  })
})
