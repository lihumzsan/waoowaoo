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
  promptMock,
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

  it('revises a prompt-generated script using the previous full script as context', async () => {
    sourceDocumentMock.readEpisodeSourceDocumentById
      .mockResolvedValueOnce({
        id: 'source-revision',
        episodeId: 'episode-1',
        normalizedText: '把结尾改成更冷峻',
        checksum: 'checksum-revision',
        sourceKind: 'prompt_generated_outline',
        scriptStructureJson: null,
        rawFileMediaId: null,
        version: 1,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'source-previous',
        episodeId: 'episode-1',
        normalizedText: '上一版完整剧本',
        checksum: 'checksum-previous',
        sourceKind: 'prompt_generated_script',
        scriptStructureJson: null,
        rawFileMediaId: null,
        version: 2,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:01:00Z'),
      })

    await handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      sourceDocumentId: 'source-revision',
      previousSourceDocumentId: 'source-previous',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }, TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE))

    expect(sourceDocumentMock.readEpisodeSourceDocumentById).toHaveBeenNthCalledWith(2, {
      projectId: 'project-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-previous',
    })
    expect(promptMock.buildAiPromptContent).toHaveBeenCalledWith(expect.objectContaining({
      variables: {
        user_prompt: expect.stringContaining('上一版完整剧本'),
      },
    }))
    expect(promptMock.buildAiPromptContent).toHaveBeenCalledWith(expect.objectContaining({
      variables: {
        user_prompt: expect.stringContaining('把结尾改成更冷峻'),
      },
    }))
    expect(editBibleMock.generateEditBibleArtifacts).not.toHaveBeenCalled()
  })
})
