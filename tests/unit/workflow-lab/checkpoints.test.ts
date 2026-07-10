import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  listWorkflowLabCheckpointsFromMessages,
  sliceWorkflowLabMessagesAtCheckpoint,
} from '@/lib/workflow-lab/checkpoints'
import {
  buildWorkflowLabMessageReplacementMap,
  rewriteWorkflowLabAssistantMessages,
} from '@/lib/workflow-lab/message-rewrite'

function buildMessages(): UIMessage[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'start' }],
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'choose style' },
        {
          type: 'data-assistant-choice-card',
          data: {
            cardId: 'edit-first-style:bible-source',
            runId: 'run-source',
            interruptionId: 'choice-interruption-source',
            toolCallId: 'tool-1',
            choiceType: 'style',
            title: 'Choose style',
            description: 'Pick one.',
            groups: [
              {
                key: 'stylePreviewId',
                label: 'Style',
                required: true,
                options: [
                  {
                    value: 'preview-source',
                    label: 'Preview',
                  },
                ],
              },
            ],
            submitLabel: 'Confirm',
            submit: { kind: 'submit_tool_output' },
          },
        },
      ],
    },
    {
      id: 'assistant-2',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'generate edit assets' },
        {
          type: 'data-agent-operation-start',
          data: {
            runId: 'run-source',
            operationId: 'generate_edit_script_assets',
            toolCallId: 'tool-generate-assets',
          },
        },
      ],
    },
    {
      id: 'assistant-3',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'ready to generate videos' },
        {
          type: 'data-agent-interruption',
          data: {
            runId: 'run-source',
            requestId: 'request-source',
            interruptionId: 'interruption-source',
            approvalId: 'approval-source',
            operationId: 'generate_episode_videos',
            toolCallId: 'tool-approval',
            inputHash: 'input-hash-1',
            display: {
              title: 'Generate videos',
              description: 'Generate videos now.',
            },
          },
        },
      ],
    },
  ]
}

describe('workflow lab checkpoints', () => {
  it('derives restorable checkpoints from real assistant data parts', () => {
    const checkpoints = listWorkflowLabCheckpointsFromMessages({
      sourceEpisodeId: 'episode-source',
      messages: buildMessages(),
    })

    expect(checkpoints).toHaveLength(3)
    expect(checkpoints[0]).toMatchObject({
      kind: 'choice',
      workflowStage: 'needs_style_choice',
      choiceType: 'style',
      messageIndex: 1,
      partIndex: 1,
    })
    expect(checkpoints[1]).toMatchObject({
      kind: 'stage',
      workflowStage: 'ready_to_generate_assets',
      operationId: 'generate_edit_script_assets',
      messageIndex: 2,
      partIndex: 1,
    })
    expect(checkpoints[2]).toMatchObject({
      kind: 'approval',
      workflowStage: 'ready_to_generate_videos',
      operationId: 'generate_episode_videos',
      messageIndex: 3,
      partIndex: 1,
    })
  })

  it('keeps choice cards active but trims unsafe approval cards before restore', () => {
    const messages = buildMessages()
    const checkpoints = listWorkflowLabCheckpointsFromMessages({
      sourceEpisodeId: 'episode-source',
      messages,
    })

    const choiceSlice = sliceWorkflowLabMessagesAtCheckpoint({
      messages,
      checkpoint: checkpoints[0],
      includeCheckpointPart: true,
    })
    expect(choiceSlice).toHaveLength(2)
    expect(choiceSlice[1]?.parts.map((part) => part.type)).toEqual(['text', 'data-assistant-choice-card'])

    const stageCheckpoint = checkpoints.find((checkpoint) => checkpoint.kind === 'stage')
    if (!stageCheckpoint) throw new Error('EXPECTED_STAGE_CHECKPOINT')
    const stageSlice = sliceWorkflowLabMessagesAtCheckpoint({
      messages,
      checkpoint: stageCheckpoint,
      includeCheckpointPart: false,
    })
    expect(stageSlice).toHaveLength(3)
    expect(stageSlice[2]?.parts.map((part) => part.type)).toEqual(['text'])

    const approvalCheckpoint = checkpoints.find((checkpoint) => checkpoint.kind === 'approval')
    if (!approvalCheckpoint) throw new Error('EXPECTED_APPROVAL_CHECKPOINT')
    const approvalSlice = sliceWorkflowLabMessagesAtCheckpoint({
      messages,
      checkpoint: approvalCheckpoint,
      includeCheckpointPart: false,
    })
    expect(approvalSlice).toHaveLength(4)
    expect(approvalSlice[3]?.parts.map((part) => part.type)).toEqual(['text'])
  })

  it('rewrites exact artifact ids without restoring project or episode ids in Choice submit data', () => {
    const messages = sliceWorkflowLabMessagesAtCheckpoint({
      messages: buildMessages(),
      checkpoint: listWorkflowLabCheckpointsFromMessages({
        sourceEpisodeId: 'episode-source',
        messages: buildMessages(),
      })[0],
      includeCheckpointPart: true,
    })

    const rewritten = rewriteWorkflowLabAssistantMessages({
      messages,
      replacements: buildWorkflowLabMessageReplacementMap({
        sourceProjectId: 'project-source',
        targetProjectId: 'project-lab',
        sourceEpisodeId: 'episode-source',
        targetEpisodeId: 'episode-lab',
        idMap: new Map([
          ['bible-source', 'bible-lab'],
          ['preview-source', 'preview-lab'],
        ]),
      }),
    })

    expect(JSON.stringify(rewritten)).not.toContain('project-source')
    expect(JSON.stringify(rewritten)).not.toContain('episode-source')
    expect(JSON.stringify(rewritten)).toContain('preview-lab')
    expect(JSON.stringify(rewritten)).toContain('edit-first-style:bible-lab')
    expect(JSON.stringify(rewritten)).not.toContain('bible-source')
  })
})
