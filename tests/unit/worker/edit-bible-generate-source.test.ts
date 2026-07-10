import {
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

  it('requires sourceDocumentId explicitly', async () => {
    await expect(handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }))).rejects.toThrow('sourceDocumentId is required')
  })
})
