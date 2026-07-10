import {
  buildWorkspaceNodeCanvasProjection,
  describe,
  editBibleNode,
  expect,
  isWorkspaceCanvasLifecycleRunning,
  it,
  t,
  workflow,
} from './project-canvas-resource-lifecycle.fixture'

describe('project canvas resource lifecycle', () => {
  it('does not render a placeholder node when the bible artifact does not exist', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_ingest_script'),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes).toEqual([])
    expect(projection.edges).toEqual([])
  })

  it('treats bible review as a succeeded artifact instead of a running node', () => {
    const node = editBibleNode({ status: 'ready_for_review' })

    expect(node.data.lifecycle.phase).toBe('succeeded')
    expect(isWorkspaceCanvasLifecycleRunning(node.data.lifecycle)).toBe(false)
  })

  it('passes structured production planning modules into edit bible node details', () => {
    const bible = {
      synopsis: '一名研究员在地下实验室发现时间循环。',
      characters: [{
        entityId: 'character-lin',
        name: '林',
        aliases: ['林博士'],
        summary: '民间科学家，试图关闭失控装置。',
        voiceProfile: {
          register: 'low',
          pace: 'measured',
          timbre: 'dry',
          delivery: 'restrained',
        },
      }],
      locations: [{
        entityId: 'location-lab',
        name: '地下实验室',
        aliases: [],
        summary: '潮湿、幽暗、堆满旧服务器的封闭空间。',
      }],
      worldRules: ['时间循环每十分钟重置一次。'],
      styleGuide: {
        visualTone: '冷峻压迫',
      },
    }
    const beatSheet = {
      beats: [{
        beatId: 'beat-1',
        title: '发现循环',
        summary: '林发现实验室时间正在重置。',
        sourceStart: 0,
        sourceEnd: 20,
        estimatedDurationSec: 45,
      }],
    }
    const ledger = {
      events: [{
        eventId: 'event-1',
        kind: 'plot',
        summary: '循环规则被确认。',
        sourceStart: 0,
        sourceEnd: 20,
        entities: [{ entityType: 'world', entityName: '时间循环' }],
        persistentFacts: ['循环每十分钟发生。'],
      }],
    }
    const emotionalCurve = {
      cues: [{
        cueId: 'cue-1',
        mood: '压迫',
        intensity: 0.8,
        musicPolicy: 'underscore',
        sourceStart: 0,
        sourceEnd: 20,
        note: '低频持续推进。',
      }],
    }
    const node = editBibleNode({
      status: 'ready_for_review',
      bibleOverrides: {
        bible,
        beatSheet,
        ledger,
        emotionalCurve,
        chapters: [{
          id: 'chapter-1',
          chapterIndex: 0,
          title: '循环开启',
          summary: '林发现循环并尝试确认规则。',
          sourceStart: 0,
          sourceEnd: 20,
          targetDurationSec: 45,
          beatIds: ['beat-1'],
          eventIds: ['event-1'],
          status: 'ready',
          renderStatus: null,
          outputMediaId: null,
        }],
      },
    })

    expect(node.data.editBibleDetails?.bible).toEqual(bible)
    expect(node.data.editBibleDetails?.beatSheet).toEqual(beatSheet)
    expect(node.data.editBibleDetails?.ledger).toEqual(ledger)
    expect(node.data.editBibleDetails?.emotionalCurve).toEqual(emotionalCurve)
    expect(node.data.editBibleDetails?.chapters).toEqual([{
      id: 'chapter-1',
      chapterIndex: 0,
      title: '循环开启',
      summary: '林发现循环并尝试确认规则。',
      targetDurationSec: 45,
      status: 'ready',
      renderStatus: null,
      outputMediaId: null,
    }])
  })
})
