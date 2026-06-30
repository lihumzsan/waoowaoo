import { describe, expect, it } from 'vitest'
import type { ProjectAssistantThreadSnapshot } from '@/lib/project-agent/types'
import {
  buildWorkspaceAssistantThreadLogFileName,
  serializeWorkspaceAssistantThreadLog,
} from '@/lib/project-agent/thread-log'

describe('project assistant thread log', () => {
  it('serializes dialogue, tool calls, and structured data into a readable log', () => {
    const thread: ProjectAssistantThreadSnapshot = {
      id: 'thread-1',
      assistantId: 'workspace-command',
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeRef: 'episode:episode-1',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: '修改第七个分镜提示词' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'text', text: '好的，我先确认要修改的分镜。' },
            {
              type: 'tool-update_storyboard_panel_prompt',
              toolCallId: 'tool-call-1',
              state: 'output-available',
              input: { panelNumber: 7, prompt: '更强的逆光', confirmed: false },
              output: { ok: true, operationId: 'update_storyboard_panel_prompt' },
            },
            {
              type: 'data-agent-stop',
              data: {
                reason: 'awaiting_external_task',
                operationIds: ['generate_edit_script'],
                taskIds: ['task-1'],
              },
            },
          ],
        },
      ],
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:05.000Z',
    }

    const text = serializeWorkspaceAssistantThreadLog({ thread })

    expect(text).toContain('# Workspace Assistant Thread Log')
    expect(text).toContain('## 01 USER')
    expect(text).toContain('修改第七个分镜提示词')
    expect(text).toContain('### Tool update_storyboard_panel_prompt')
    expect(text).toContain('"panelNumber": 7')
    expect(text).toContain('### data-agent-stop')
    expect(text).toContain('"reason": "awaiting_external_task"')
  })

  it('builds a stable download filename from project scope and thread id', () => {
    expect(buildWorkspaceAssistantThreadLogFileName({
      id: 'thread-1',
      assistantId: 'workspace-command',
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeRef: 'episode:episode-1',
      messages: [],
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:05.000Z',
    })).toBe('workspace-assistant__project-1__episode_episode-1__thread-1.log')
  })

  it('renders runtime context as summary and omits nested raw/model messages', () => {
    const thread: ProjectAssistantThreadSnapshot = {
      id: 'thread-1',
      assistantId: 'workspace-command',
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeRef: 'episode:episode-1',
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        parts: [{
          type: 'data-agent-runtime-context',
          data: {
            requestId: 'request-1',
            modelKey: 'model-1',
            toolset: { source: 'deterministic-workflow' },
            selectedTools: [{ operationId: 'get_project_context' }],
            messageCounts: { normalized: 3, runtime: 2, model: 2 },
            contextTokenEstimate: 120,
            rawMessages: [{ role: 'user', parts: [{ text: 'nested' }] }],
            modelMessages: [{ role: 'user', content: 'nested' }],
          },
        } as unknown as ProjectAssistantThreadSnapshot['messages'][number]['parts'][number]],
      }],
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:05.000Z',
    }

    const text = serializeWorkspaceAssistantThreadLog({ thread })

    expect(text).toContain('"requestId": "request-1"')
    expect(text).toContain('"contextTokenEstimate": 120')
    expect(text).not.toContain('rawMessages')
    expect(text).not.toContain('modelMessages')
    expect(text).not.toContain('nested')
  })
})
