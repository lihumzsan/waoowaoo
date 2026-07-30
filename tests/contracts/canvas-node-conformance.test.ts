import { describe, expect, it } from 'vitest'
import { WORKSPACE_CANVAS_NODE_DEFINITIONS } from '@/features/project-workspace/canvas/registry/workspace-canvas-node-registry'
import { WORKSPACE_CANVAS_NODE_RENDERERS } from '@/features/project-workspace/canvas/nodes/workspace-node-renderer-registry'
import {
  getWorkspaceCanvasNodePresentationProfile,
  resolveWorkspaceCanvasMediaShell,
  resolveWorkspaceCanvasNodeSize,
} from '@/features/project-workspace/canvas/node-presentation-profiles'
import { CREATIVE_RESOURCE_MEDIA_TYPES } from '@/lib/creative-resource/contracts'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { TASK_TYPE } from '@/lib/task/types'

describe('workspace Canvas node registry conformance', () => {
  it('exposes one Resource node kind with an exhaustive renderer and presentation', () => {
    expect(Object.keys(WORKSPACE_CANVAS_NODE_DEFINITIONS)).toEqual(['resourceCard'])
    expect(Object.keys(WORKSPACE_CANVAS_NODE_RENDERERS)).toEqual(['resourceCard'])

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
      TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE,
    ])
  })

  it('declares a media presentation for every Resource media type', () => {
    const profile = getWorkspaceCanvasNodePresentationProfile('resourceCard')
    expect(Object.keys(profile.media).sort()).toEqual([...CREATIVE_RESOURCE_MEDIA_TYPES].sort())

    for (const mediaType of CREATIVE_RESOURCE_MEDIA_TYPES) {
      const shell = resolveWorkspaceCanvasMediaShell({
        kind: 'resourceCard',
        mediaType,
        schemaId: mediaType === 'image' ? CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE : `generic.${mediaType}`,
        projectAspectRatio: '16:9',
      })
      const size = resolveWorkspaceCanvasNodeSize({
        kind: 'resourceCard',
        mediaType,
        schemaId: mediaType === 'image' ? CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE : `generic.${mediaType}`,
        projectAspectRatio: '16:9',
      })
      expect(shell.width).toBeGreaterThan(0)
      expect(shell.height).toBeGreaterThan(0)
      expect(size.width).toBeGreaterThan(shell.width)
      expect(size.height).toBeGreaterThan(shell.height)
    }
  })

  it('derives frame cards from the project aspect ratio with an identical pending shell', () => {
    const wide = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'image',
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      projectAspectRatio: '16:9',
    })
    const tall = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'image',
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      projectAspectRatio: '9:16',
    })
    expect(wide.form).toBe('frame')
    expect(tall.form).toBe('frame')
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1)
    expect(tall.width / tall.height).toBeCloseTo(9 / 16, 1)

    const fallback = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'video',
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
      projectAspectRatio: null,
    })
    expect(fallback.width / fallback.height).toBeCloseTo(16 / 9, 1)
  })

  it('resolves frozen ratio, media dimensions, and asset policy before the project ratio', () => {
    const frozen = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'image',
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      generationOptions: { aspectRatio: '1:1' },
      mediaWidth: 1600,
      mediaHeight: 900,
      projectAspectRatio: '9:16',
    })
    expect(frozen.width / frozen.height).toBeCloseTo(1, 1)

    const media = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'image',
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      mediaWidth: 1600,
      mediaHeight: 900,
      projectAspectRatio: '9:16',
    })
    expect(media.width / media.height).toBeCloseTo(16 / 9, 1)

    const asset = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'image',
      schemaId: CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
      projectAspectRatio: '16:9',
    })
    expect(asset.width / asset.height).toBeCloseTo(4 / 3, 1)
    expect(asset.fit).toBe('contain')
  })
})
