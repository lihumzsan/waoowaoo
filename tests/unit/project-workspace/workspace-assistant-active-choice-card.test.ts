import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'
import { findActiveChoiceCard } from '@/features/project-workspace/components/workspace-assistant/active-choice-card'

const choiceCard: ProjectAgentChoiceCardPartData = {
  cardId: 'edit-first-duration-aspect-ratio',
  title: '选择短片时长和画面比例',
  groups: [
    {
      key: 'durationSeconds',
      label: '时长',
      required: true,
      options: [{ value: '60', label: '60 秒' }],
    },
  ],
  submitLabel: '继续生成',
  submit: {
    kind: 'send_message',
    messageTemplate: '继续',
  },
}

function userMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function assistantChoiceCardMessage(id: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{
      type: 'data-assistant-choice-card',
      data: choiceCard,
    } as unknown as UIMessage['parts'][number]],
  }
}

describe('workspace assistant active choice card', () => {
  it('returns a choice card created after the latest user message', () => {
    const active = findActiveChoiceCard([
      userMessage('user-1', '开始生成'),
      assistantChoiceCardMessage('assistant-1'),
    ], new Set())

    expect(active).toEqual({
      key: 'assistant-1:part:0:edit-first-duration-aspect-ratio',
      data: choiceCard,
    })
  })

  it('does not restore an old choice card after a later user message submitted the selection', () => {
    const active = findActiveChoiceCard([
      userMessage('user-1', '开始生成'),
      assistantChoiceCardMessage('assistant-1'),
      userMessage('user-2', '我选择 60 秒和 16:9 画面比例，请继续。'),
    ], new Set())

    expect(active).toBeNull()
  })

  it('does not return a dismissed choice card from the current user turn', () => {
    const active = findActiveChoiceCard([
      userMessage('user-1', '开始生成'),
      assistantChoiceCardMessage('assistant-1'),
    ], new Set(['assistant-1:part:0:edit-first-duration-aspect-ratio']))

    expect(active).toBeNull()
  })
})
