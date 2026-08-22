import { describe, expect, it } from 'vitest'
import {
  formatAssistantRuntimeSelectedResourceReference,
  parseAssistantRuntimeSelectedResourceReference,
} from '@/lib/assistant-runtime/selected-resource-reference'

describe('assistant runtime selected resource reference', () => {
  it('gives the model a frozen video identity without embedding video bytes', () => {
    const text = formatAssistantRuntimeSelectedResourceReference({
      resourceId: 'r_video_016',
      contentVersion: 3,
      workspacePath: 'episodes/04/016-sixth-floor-bed.mp4',
      name: '016_六楼病床束缚',
      mediaType: 'video',
    })

    expect(text).toContain('resource_id: r_video_016')
    expect(text).toContain('content_version: 3')
    expect(text).toContain('workspace_path: "episodes/04/016-sixth-floor-bed.mp4"')
    expect(text).toContain('name: "016_六楼病床束缚"')
    expect(text).toContain('media_type: video')
    expect(text).not.toContain('data:video')
  })

  it('keeps an exact persisted reference and rejects an unversioned one', () => {
    expect(parseAssistantRuntimeSelectedResourceReference({
      resourceId: 'r_video_016',
      contentVersion: 3,
      workspacePath: 'episodes/04/016-sixth-floor-bed.mp4',
      name: '016_六楼病床束缚',
      mediaType: 'video',
    })).toEqual({
      resourceId: 'r_video_016',
      contentVersion: 3,
      workspacePath: 'episodes/04/016-sixth-floor-bed.mp4',
      name: '016_六楼病床束缚',
      mediaType: 'video',
    })
    expect(() => parseAssistantRuntimeSelectedResourceReference({
      resourceId: 'r_video_016',
      workspacePath: 'episodes/04/016-sixth-floor-bed.mp4',
      name: '016_六楼病床束缚',
      mediaType: 'video',
    })).toThrow('ASSISTANT_RUNTIME_SELECTED_RESOURCE_INVALID')
  })
})
