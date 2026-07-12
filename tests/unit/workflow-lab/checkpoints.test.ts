import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  listWorkflowLabCheckpointsFromMessages,
  type WorkflowLabInterruptionSource,
} from '@/lib/workflow-lab/checkpoints'
import { addWorkflowLabPlanTargetReplacements } from '@/lib/workflow-lab/clone-json'
import {
  shouldWorkflowLabCloneConfirmedStyleBible,
  shouldWorkflowLabKeepAssetRequirementTarget,
  shouldWorkflowLabKeepChapterRenderOutcome,
} from '@/lib/workflow-lab/clone-stage'

function assistantMessage(parts: readonly unknown[]): UIMessage {
  return {
    id: 'assistant-message',
    role: 'assistant',
    parts,
  } as unknown as UIMessage
}

function approvalPart(input: {
  readonly interruptionId: string
  readonly toolCallId: string
  readonly operationId?: string
}): unknown {
  const operationId = input.operationId ?? 'generate_edit_script_assets'
  return {
    type: 'data-agent-interruption',
    data: {
      runId: 'run-source',
      requestId: 'request-source',
      interruptionId: input.interruptionId,
      approvalId: `approval:${input.interruptionId}`,
      operationId,
      inputHash: 'input-hash',
      toolCallId: input.toolCallId,
      display: {
        title: 'Approve operation',
        description: 'Approve the frozen plan',
      },
    },
  }
}

function approvalSource(input: {
  readonly id: string
  readonly toolCallId: string
  readonly runState: string | null
  readonly status?: string
}): WorkflowLabInterruptionSource {
  return {
    id: input.id,
    runId: 'run-source',
    type: 'approval',
    status: input.status ?? 'pending',
    operationId: 'generate_edit_script_assets',
    approvalId: `approval:${input.id}`,
    toolCallId: input.toolCallId,
    payload: {},
    runState: input.runState,
  }
}

describe('Workflow Lab checkpoint authority', () => {
  it('preserves existing asset ownership at the frozen asset-generation Approval boundary', () => {
    expect(shouldWorkflowLabKeepAssetRequirementTarget('ready_to_generate_edit_script')).toBe(false)
    expect(shouldWorkflowLabKeepAssetRequirementTarget('ready_to_generate_assets')).toBe(true)
  })

  it('removes future chapter renders until the audio-stage checkpoint', () => {
    expect(shouldWorkflowLabKeepChapterRenderOutcome('ready_to_generate_videos')).toBe(false)
    expect(shouldWorkflowLabKeepChapterRenderOutcome('ready_to_render_chapters')).toBe(false)
    expect(shouldWorkflowLabKeepChapterRenderOutcome('ready_to_generate_bgm_score')).toBe(true)
  })

  it('does not leak a confirmed Style Bible into generation or choice checkpoints', () => {
    expect(shouldWorkflowLabCloneConfirmedStyleBible('bible_ready_for_review')).toBe(false)
    expect(shouldWorkflowLabCloneConfirmedStyleBible('style_preview_generating')).toBe(false)
    expect(shouldWorkflowLabCloneConfirmedStyleBible('needs_style_choice')).toBe(false)
    expect(shouldWorkflowLabCloneConfirmedStyleBible('ready_to_generate_edit_script')).toBe(true)
  })

  it('does not guess an interruption when a historical tool-call identity is duplicated', () => {
    const checkpoints = listWorkflowLabCheckpointsFromMessages({
      sourceEpisodeId: 'episode-source',
      messages: [assistantMessage([{ type: 'dynamic-tool', toolCallId: 'duplicated-tool-call' }])],
      interruptions: [
        approvalSource({ id: 'approval-one', toolCallId: 'duplicated-tool-call', runState: '{}', status: 'consumed' }),
        approvalSource({ id: 'approval-two', toolCallId: 'duplicated-tool-call', runState: '{}', status: 'consumed' }),
      ],
    })

    expect(checkpoints).toEqual([])
  })

  it('gives every unmapped plan-only target a fresh clone identity', () => {
    const replacements = new Map([['existing-target', 'cloned-existing-target']])
    const generated = ['new-parent-identity', 'new-target-one', 'new-target-two'][Symbol.iterator]()
    addWorkflowLabPlanTargetReplacements({
      planSnapshot: {
        kind: 'task_submission',
        reservedIdentityIds: ['planned-parent-identity'],
        tasks: [
          { target: { targetId: 'existing-target' } },
          { target: { targetId: 'planned-target-one' } },
          { target: { targetId: 'planned-target-two' } },
        ],
      },
      replacements,
      createId: () => generated.next().value ?? 'unexpected-extra-id',
    })

    expect(Object.fromEntries(replacements)).toEqual({
      'existing-target': 'cloned-existing-target',
      'planned-parent-identity': 'new-parent-identity',
      'planned-target-one': 'new-target-one',
      'planned-target-two': 'new-target-two',
    })
  })

  it('uses the explicit durable interruption identity even when the tool-call fallback is ambiguous', () => {
    const checkpoints = listWorkflowLabCheckpointsFromMessages({
      sourceEpisodeId: 'episode-source',
      messages: [assistantMessage([
        approvalPart({ interruptionId: 'approval-two', toolCallId: 'duplicated-tool-call' }),
      ])],
      interruptions: [
        approvalSource({ id: 'approval-one', toolCallId: 'duplicated-tool-call', runState: '{}', status: 'consumed' }),
        approvalSource({ id: 'approval-two', toolCallId: 'duplicated-tool-call', runState: '{}', status: 'consumed' }),
      ],
    })

    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]).toMatchObject({
      kind: 'approval',
      sourceInterruptionId: 'approval-two',
      workflowStage: 'ready_to_generate_assets',
    })
  })

  it('does not advertise an Approval checkpoint without its frozen resume state', () => {
    const checkpoints = listWorkflowLabCheckpointsFromMessages({
      sourceEpisodeId: 'episode-source',
      messages: [assistantMessage([
        approvalPart({ interruptionId: 'approval-one', toolCallId: 'tool-call-one' }),
      ])],
      interruptions: [
        approvalSource({ id: 'approval-one', toolCallId: 'tool-call-one', runState: null }),
      ],
    })

    expect(checkpoints).toEqual([])
  })

  it('lists a pending durable Approval even when its UI message part was not retained', () => {
    const checkpoints = listWorkflowLabCheckpointsFromMessages({
      sourceEpisodeId: 'episode-source',
      messages: [assistantMessage([{ type: 'text', text: 'checkpoint history' }])],
      interruptions: [
        approvalSource({ id: 'approval-one', toolCallId: 'tool-call-one', runState: '{}' }),
        approvalSource({
          id: 'approval-consumed',
          toolCallId: 'tool-call-consumed',
          runState: '{}',
          status: 'consumed',
        }),
      ],
    })

    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]).toMatchObject({
      kind: 'approval',
      sourceInterruptionId: 'approval-one',
      workflowStage: 'ready_to_generate_assets',
    })
  })
})
