import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceStructuredStreamPatches,
  buildStreamRuntimeEntries,
  type StructuredStreamSnapshot,
} from '@/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime'
import type {
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeData,
} from '@/features/project-workspace/canvas/node-canvas-types'
import type {
  WorkspaceCanvasStreamPatch,
} from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'

function workspaceNode(input: {
  readonly id: string
  readonly kind: WorkspaceCanvasNodeData['kind']
  readonly targetType: WorkspaceCanvasNodeData['targetType']
  readonly targetId: string
  readonly body?: string
}): WorkspaceCanvasFlowNode {
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind: input.kind,
      mediaLoadingContext: null,
      layoutNodeType: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      title: input.id,
      eyebrow: input.kind,
      body: input.body ?? 'base',
      meta: '',
      statusLabel: '',
      width: 240,
      height: 160,
    },
  }
}

describe('workspace structured stream runtime', () => {
  it('surfaces shot execution stream parse errors as failed patches before any shot item is parsed', () => {
    const snapshots: readonly StructuredStreamSnapshot[] = [{
      taskId: 'task-shot-plan',
      taskType: null,
      targetType: 'ProjectEditScript',
      targetId: 'edit-script-1',
      episodeId: 'episode-1',
      adapterKey: 'shotExecutionPlan.shots',
      items: [],
      errorMessage: 'Invalid shot execution stream JSON',
    }]

    const entries = buildStreamRuntimeEntries(snapshots, 'episode-1', (key, values) => {
      if (key === 'nodes.editShotExecutionPlan.meta') return `shots:${values?.shots ?? 0}`
      return key
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.target).toMatchObject({
      nodeId: 'edit-shot-execution-plan:edit-script:edit-script-1',
      streamKind: 'editShotExecutionPlan',
      targetId: 'edit-script-1',
    })
    expect(entries[0]?.patch.data).toMatchObject({
      body: 'Invalid shot execution stream JSON',
      meta: 'Invalid shot execution stream JSON',
      artifactPhase: 'failed',
      statusLabel: 'status.failed',
      isRunning: false,
    })
    expect(entries[0]?.patch.data.editPipelineStepDetails).toBeUndefined()
  })

  it('keeps unmatched stream patches buffered instead of throwing during render', () => {
    const patch: WorkspaceCanvasStreamPatch = {
      streamKind: 'editScript',
      nodeId: 'edit-script:episode-1:chapter-1',
      taskId: 'task-1',
      data: {
        isRunning: true,
        statusLabel: 'processing',
      },
    }

    expect(() => applyWorkspaceStructuredStreamPatches([], [patch])).not.toThrow()
  })

  it('applies a patch to the matching canonical node', () => {
    const nodes = [
      workspaceNode({
        id: 'edit-shot-execution-plan:edit-script:script-1',
        kind: 'editShotExecutionPlan',
        targetType: 'editShotExecutionPlan',
        targetId: 'script-1',
      }),
    ]
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'edit-shot-execution-plan:edit-script:script-1',
      streamKind: 'editShotExecutionPlan',
      taskId: 'task-1',
      data: {
        body: 'streamed',
        isRunning: true,
      },
    }]

    const result = applyWorkspaceStructuredStreamPatches(nodes, patches)

    expect(result[0]?.data.body).toBe('streamed')
    expect(result[0]?.data.isRunning).toBe(true)
  })

  it('applies soundscape stream patches to the matching soundscape node', () => {
    const nodes = [
      workspaceNode({
        id: 'soundscape:episode-1',
        kind: 'soundscape',
        targetType: 'episode',
        targetId: 'episode-1',
      }),
    ]
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'soundscape:episode-1',
      streamKind: 'soundscape',
      taskId: 'task-soundscape',
      data: {
        body: 'stream soundscape',
        isRunning: true,
        soundscapeDetails: {
          status: 'planning',
          decision: null,
          soundEffectModel: null,
          sourceCount: 1,
          sectionCount: 1,
          sources: [{
            sourceId: 'city_rooftop_wind',
            environmentFingerprint: 'night_city_rooftop_wind',
            prompt: 'Seamless loop of steady rooftop wind with distant city hum, no music, no voices.',
            loopDurationSeconds: 30,
            promptInfluence: 0.55,
          }],
          sections: [{
            sourceId: 'city_rooftop_wind',
            fromShotId: 'shot_012',
            toShotId: 'shot_018',
            perspective: 'exterior_near',
            intensity: 'medium',
            transitionIn: 'fade',
            transitionOut: 'crossfade',
          }],
        },
      },
    }]

    const result = applyWorkspaceStructuredStreamPatches(nodes, patches)

    expect(result[0]?.data.body).toBe('stream soundscape')
    expect(result[0]?.data.isRunning).toBe(true)
    expect(result[0]?.data.soundscapeDetails).toMatchObject({
      status: 'planning',
      sourceCount: 1,
      sectionCount: 1,
      sources: [{ sourceId: 'city_rooftop_wind' }],
      sections: [{ fromShotId: 'shot_012', toShotId: 'shot_018' }],
    })
  })

  it('leaves off-projection batch patches unapplied instead of crashing the canvas', () => {
    const nodes = [
      workspaceNode({
        id: 'edit-shot-execution-plan:edit-script:visible-script',
        kind: 'editShotExecutionPlan',
        targetType: 'editShotExecutionPlan',
        targetId: 'visible-script',
      }),
    ]
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'edit-shot-execution-plan:edit-script:hidden-script',
      streamKind: 'editShotExecutionPlan',
      taskId: 'task-hidden',
      data: {
        body: 'hidden streamed body',
        isRunning: true,
      },
    }]

    expect(() => applyWorkspaceStructuredStreamPatches(nodes, patches)).not.toThrow()
    expect(applyWorkspaceStructuredStreamPatches(nodes, patches)).toEqual(nodes)
  })

  it('does not let source script stream patches overwrite persisted source script details', () => {
    const nodes = [
      workspaceNode({
        id: 'edit-source-script:episode:episode-1',
        kind: 'editSourceScript',
        targetType: 'editSourceScript',
        targetId: 'bible-1',
        body: 'persisted source',
      }),
    ].map((node) => ({
      ...node,
      data: {
        ...node.data,
        isRunning: false,
        sourceScriptDetails: {
          sourceText: 'persisted source',
          scriptStructure: {
            version: 1,
            title: 'Persisted',
            summary: 'Persisted summary',
            episodes: [],
          },
        },
      },
    }))
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'edit-source-script:episode:episode-1',
      streamKind: 'editSourceScript',
      taskId: 'task-1',
      data: {
        body: 'stream source',
        isRunning: true,
      },
    }]

    const result = applyWorkspaceStructuredStreamPatches(nodes, patches)

    expect(result[0]?.data.body).toBe('persisted source')
    expect(result[0]?.data.isRunning).toBe(false)
  })

  it('does not let production planning stream patches overwrite persisted production details', () => {
    const nodes = [
      workspaceNode({
        id: 'edit-bible:episode:episode-1',
        kind: 'editBible',
        targetType: 'editBible',
        targetId: 'bible-1',
        body: 'persisted plan',
      }),
    ].map((node) => ({
      ...node,
      data: {
        ...node.data,
        isRunning: false,
        editBibleDetails: {
          bibleText: 'persisted plan',
          bible: {
            synopsis: 'persisted plan',
            characters: [],
            locations: [],
            worldRules: [],
            styleGuide: {},
          },
          chapters: [],
        },
      },
    }))
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'edit-bible:episode:episode-1',
      streamKind: 'editBible',
      taskId: 'task-1',
      data: {
        body: 'stream plan',
        isRunning: true,
      },
    }]

    const result = applyWorkspaceStructuredStreamPatches(nodes, patches)

    expect(result[0]?.data.body).toBe('persisted plan')
    expect(result[0]?.data.isRunning).toBe(false)
  })

  it('does not let soundscape stream patches overwrite persisted soundscape planning details', () => {
    const nodes = [
      workspaceNode({
        id: 'soundscape:episode-1',
        kind: 'soundscape',
        targetType: 'episode',
        targetId: 'episode-1',
        body: 'persisted soundscape',
      }),
    ].map((node) => ({
      ...node,
      data: {
        ...node.data,
        isRunning: false,
        soundscapeDetails: {
          status: 'completed',
          decision: 'soundscape' as const,
          soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
          sourceCount: 1,
          sectionCount: 1,
          sources: [{
            sourceId: 'persisted_wind',
            environmentFingerprint: 'persisted_env',
            prompt: 'Persisted seamless wind ambience prompt with no music or voices.',
            loopDurationSeconds: 30,
            promptInfluence: 0.55,
          }],
          sections: [{
            sourceId: 'persisted_wind',
            fromShotId: 'shot_001',
            toShotId: 'shot_002',
            perspective: 'exterior_near',
            intensity: 'medium',
            transitionIn: 'fade',
            transitionOut: 'fade',
          }],
        },
      },
    }))
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'soundscape:episode-1',
      streamKind: 'soundscape',
      taskId: 'task-soundscape',
      data: {
        body: 'stream soundscape',
        isRunning: true,
        soundscapeDetails: {
          status: 'planning',
          decision: null,
          soundEffectModel: null,
          sourceCount: 1,
          sectionCount: 1,
          sources: [{
            sourceId: 'streamed_wind',
            environmentFingerprint: 'streamed_env',
            prompt: 'Streamed seamless wind ambience prompt with no music or voices.',
            loopDurationSeconds: 30,
            promptInfluence: 0.55,
          }],
          sections: [],
        },
      },
    }]

    const result = applyWorkspaceStructuredStreamPatches(nodes, patches)

    expect(result[0]?.data.body).toBe('persisted soundscape')
    expect(result[0]?.data.isRunning).toBe(false)
    expect(result[0]?.data.soundscapeDetails).toMatchObject({
      status: 'completed',
      decision: 'soundscape',
      sources: [{ sourceId: 'persisted_wind' }],
    })
  })
})
