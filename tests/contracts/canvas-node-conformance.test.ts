import { describe, expect, it } from 'vitest'
import { WORKSPACE_CANVAS_NODE_DEFINITIONS } from '@/features/project-workspace/canvas/registry/workspace-canvas-node-registry'
import { WORKSPACE_CANVAS_NODE_RENDERERS } from '@/features/project-workspace/canvas/nodes/workspace-node-renderer-registry'
import { getWorkspaceCanvasNodePresentationProfile } from '@/features/project-workspace/canvas/node-presentation-profiles'
import { TASK_TYPE } from '@/lib/task/types'

describe('workspace Canvas node registry conformance', () => {
  it('exposes one Resource node kind with an exhaustive renderer and presentation', () => {
    expect(Object.keys(WORKSPACE_CANVAS_NODE_DEFINITIONS)).toEqual(['resourceCard'])
    expect(Object.keys(WORKSPACE_CANVAS_NODE_RENDERERS)).toEqual(['resourceCard'])
    expect(getWorkspaceCanvasNodePresentationProfile('resourceCard')).toMatchObject({
      expandedLayout: 'stack',
      defaultExpanded: false,
    })

    const definition = WORKSPACE_CANVAS_NODE_DEFINITIONS.resourceCard
    expect(definition.identityScope).toBe('resource')
    expect(definition.taskTargetType).toBe('CreativeResource')
    expect(definition.rendererKey).toBe('resourceCard')
    expect(definition.conformanceFixture).toBe('resourceCard')
    expect(definition.taskTypes).toEqual([
      TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
      TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
      TASK_TYPE.CREATIVE_RESOURCE_VOICE,
      TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
      TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE,
    ])
  })
})
