import { describe, expect, it } from 'vitest'
import { shouldSendAssistantWaitFollowUp } from '@/features/project-workspace/components/workspace-assistant/wait-follow-up'

describe('workspace assistant wait follow-up', () => {
  it('does not wake the assistant after completed style preview generation because user style choice is next', () => {
    expect(shouldSendAssistantWaitFollowUp({
      operationId: 'generate_edit_style_previews',
      terminalStatus: 'completed',
    })).toBe(false)
  })

  it('keeps failure follow-ups so the assistant can explain failed background work', () => {
    expect(shouldSendAssistantWaitFollowUp({
      operationId: 'generate_edit_style_previews',
      terminalStatus: 'failed',
    })).toBe(true)
  })

  it('keeps completed follow-ups for operations that require assistant continuation', () => {
    expect(shouldSendAssistantWaitFollowUp({
      operationId: 'generate_edit_script',
      terminalStatus: 'completed',
    })).toBe(true)
  })
})
