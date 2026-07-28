import { describe, expect, it } from 'vitest'
import {
  projectCreativeResourceFileName,
  readCreativeResourceMaterializedRefs,
} from '@/lib/creative-resource/assistant-link-view'
import { projectCreativeResourceRevisionForAgent } from '@/lib/operations/domains/creative-resource/resource-ops'

describe('Assistant Resource link projection', () => {
  it('uses the canonical Resource name as the visible file name without exposing media identity', () => {
    expect(projectCreativeResourceFileName({
      resourceName: '最后一位家属｜30秒中式模拟恐怖短片',
      mimeType: 'video/mp4',
    })).toBe('最后一位家属｜30秒中式模拟恐怖短片.mp4')
    expect(projectCreativeResourceFileName({
      resourceName: 'Final Cut.MP4',
      mimeType: 'video/mp4',
    })).toBe('Final Cut.MP4')
  })

  it('requires exact Resource and Revision identities before presentation', () => {
    expect(readCreativeResourceMaterializedRefs({
      resources: [{
        resourceId: 'resource-1',
        revisionId: 'revision-1',
        videoUrl: '/m/internal-id',
      }],
    })).toEqual([{
      resourceId: 'resource-1',
      revisionId: 'revision-1',
    }])
    expect(() => readCreativeResourceMaterializedRefs({
      resources: [{ resourceId: 'resource-1' }],
    })).toThrow('CREATIVE_RESOURCE_ASSISTANT_RESULT_REVISION_ID_MISSING:0')
  })

  it('keeps media facts available to the Agent without exposing an internal media address', () => {
    const projected = projectCreativeResourceRevisionForAgent({
      revisionId: 'revision-1',
      revision: 1,
      content: {
        kind: 'media',
        mediaId: 'internal-media-id',
        url: '/m/internal-public-id',
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationMs: 30_067,
      },
      provenance: {
        operationId: 'merge_videos',
        inputHash: null,
        taskId: 'task-1',
        operationExecutionId: null,
        executionSegmentId: null,
        toolCallId: null,
        prompt: null,
        modelKey: null,
        generationOptions: null,
      },
      inputs: [],
      createdAt: '2026-07-28T00:00:00.000Z',
    })

    expect(projected.content).toEqual({
      kind: 'media',
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      durationMs: 30_067,
    })
    expect(JSON.stringify(projected)).not.toContain('/m/')
    expect(JSON.stringify(projected)).not.toContain('internal-media-id')
  })
})
