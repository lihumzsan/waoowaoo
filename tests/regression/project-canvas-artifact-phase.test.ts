import { describe, expect, it } from 'vitest'
import type { ProjectEditBible } from '@/types/project'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { TASK_TYPE } from '@/lib/task/types'
import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

function t(key: string): string {
  return key
}

function workflow(stage: EditFirstWorkflowState['stage']): EditFirstWorkflowState {
  return {
    active: true,
    stage,
    blocking: {
      kind: 'none',
      reason: null,
    },
    nextAction: null,
    allowedOperationIds: [],
  }
}

function bible(status: string, overrides: Partial<ProjectEditBible> = {}): ProjectEditBible {
  return {
    id: 'bible-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'story prompt',
    bibleText: 'bible text',
    status,
    stylePreviews: [],
    ...overrides,
  }
}

function editBibleNode(input: {
  readonly status: string
  readonly activeAssistantOperationId?: string
  readonly bibleOverrides?: Partial<ProjectEditBible>
  readonly workflowStage?: EditFirstWorkflowState['stage']
}): WorkspaceCanvasFlowNode {
  const projection = buildWorkspaceNodeCanvasProjection({
    projectId: 'project-1',
    episodeId: 'episode-1',
    episodeName: 'Episode 1',
    storyboards: [],
    editFirstWorkflow: workflow(input.workflowStage ?? 'bible_ready_for_review'),
    editBible: bible(input.status, input.bibleOverrides),
    activeAssistantOperationId: input.activeAssistantOperationId,
    savedLayouts: [],
    translate: t,
  })
  const node = projection.nodes.find((candidate) => candidate.data.kind === 'editBible')
  if (!node) throw new Error('EDIT_BIBLE_NODE_MISSING')
  return node
}

describe('project canvas artifact phase', () => {
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

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
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
        persistentFactsIntroduced: ['循环每十分钟发生。'],
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

  it('treats style confirmation as a succeeded artifact instead of a running node', () => {
    const node = editBibleNode({ status: 'confirmed' })

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('does not use assistant focus as the edit bible lifecycle authority', () => {
    const node = editBibleNode({ status: 'ready_for_review', activeAssistantOperationId: 'ingest_script' })

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('keeps a submitted edit bible generation task visible before the bible query catches up', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_ingest_script'),
      activeAssistantOperationId: 'ingest_script',
      activeTaskTargets: [{
        operationId: 'ingest_script',
        targetType: 'ProjectEditBible',
        targetId: 'bible-1',
        types: [TASK_TYPE.EDIT_BIBLE_GENERATE],
        sourceKind: 'prompt_generated_outline',
      }],
      savedLayouts: [],
      translate: t,
    })
    const node = projection.nodes.find((candidate) => candidate.data.kind === 'editBible')

    expect(node?.id).toBe('edit-bible:episode:episode-1')
    expect(node?.data.targetId).toBe('bible-1')
    expect(node?.data.title).toBe('nodes.editScriptSource.pendingTitle')
    expect(node?.data.eyebrow).toBe('nodes.editScriptSource.eyebrow')
    expect(node?.data.body).toBe('nodes.editScriptSource.pendingBody')
    expect(node?.data.artifactPhase).toBe('running')
  })

  it('labels a prompt-expanded script review node as script instead of episode plan', () => {
    const node = editBibleNode({
      status: 'script_ready_for_review',
      workflowStage: 'script_ready_for_review',
      bibleOverrides: {
        sourceKind: 'prompt_generated_script',
        sourceText: '完整扩写剧本',
      },
    })

    expect(node.data.title).toBe('nodes.editScriptSource.title')
    expect(node.data.eyebrow).toBe('nodes.editScriptSource.eyebrow')
    expect(node.data.body).toBe('完整扩写剧本')
    expect(node.data.artifactPhase).toBe('succeeded')
  })
})
