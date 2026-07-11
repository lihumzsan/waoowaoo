import { describe, expect, it } from 'vitest'
import { isWorkspaceAssistantSessionResponseFresh } from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantSessionSync'
import { isProjectAssistantThreadResponseFresh } from '@/lib/query/hooks/useProjectAssistantThread'

describe('Workspace Assistant Session watermark', () => {
  it('rejects an older Session response after a background continuation event', () => {
    expect(isWorkspaceAssistantSessionResponseFresh({
      responseEventWatermark: '41',
      requiredEventWatermark: '42',
    })).toBe(false)
    expect(isWorkspaceAssistantSessionResponseFresh({
      responseEventWatermark: '42',
      requiredEventWatermark: '42',
    })).toBe(true)
  })

  it('compares bigint watermarks without losing precision', () => {
    expect(isWorkspaceAssistantSessionResponseFresh({
      responseEventWatermark: '9007199254740993',
      requiredEventWatermark: '9007199254740992',
    })).toBe(true)
  })

  it('rejects a Thread HTTP snapshot older than a replayed clear event', () => {
    expect(isProjectAssistantThreadResponseFresh({
      responseEventWatermark: '41',
      requiredEventWatermark: '42',
    })).toBe(false)
    expect(isProjectAssistantThreadResponseFresh({
      responseEventWatermark: '42',
      requiredEventWatermark: '42',
    })).toBe(true)
  })
})
