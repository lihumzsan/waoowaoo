import { describe, expect, it } from 'vitest'
import { inspectProjectAgentContinuationContract } from '../../../scripts/guards/single-project-agent-continuation.mjs'

const validContract = {
  productionSources: '',
  continuationCallers: ['src/lib/workers/outbox.worker.ts'],
  outboxWorker: 'await runProjectAgentWaitContinuationCommand(payload, outboxId)',
  serverFollowUp: [
    'loadProjectAgentWaitContinuationCheckpoint',
    "'x-request-id': params.commandId",
    'await beginProjectAgentWaitContinuationExecution({',
    'await createProjectAgentChatResponse({',
    'await checkpointProjectAgentWaitFollowUp({',
    'await finalizeProjectAgentWaitFollowUp({',
  ].join('\n'),
  waits: [
    'projectAgentContinuationCheckpoint.findUnique',
    'appendProjectAssistantThreadMessagesInTransaction',
    'PROJECT_AGENT_CONTINUATION_CHECKPOINT_MISSING',
    "status: 'running'",
    "status: 'settled'",
  ].join('\n'),
  publicControl: '',
  externalExecutors: '',
}

describe('single Project Agent continuation guard', () => {
  it('accepts the outbox-only checkpoint-before-settlement path', () => {
    expect(inspectProjectAgentContinuationContract(validContract)).toEqual([])
  })

  it('rejects a legacy helper and a second continuation caller', () => {
    expect(inspectProjectAgentContinuationContract({
      ...validContract,
      productionSources: 'reconcilePendingProjectAgentWaitsForScope()',
      continuationCallers: [
        'src/lib/workers/outbox.worker.ts',
        'src/app/api/projects/[projectId]/assistant/chat/route.ts',
      ],
    })).toEqual([
      'legacy continuation entry must remain deleted: reconcilePendingProjectAgentWaitsForScope',
      'ProjectAgentWait continuation must have exactly one caller: src/lib/workers/outbox.worker.ts, src/app/api/projects/[projectId]/assistant/chat/route.ts',
    ])
  })

  it('rejects settlement before the durable message checkpoint', () => {
    expect(inspectProjectAgentContinuationContract({
      ...validContract,
      serverFollowUp: [
        'loadProjectAgentWaitContinuationCheckpoint',
        "'x-request-id': params.commandId",
        'await beginProjectAgentWaitContinuationExecution({',
        'await createProjectAgentChatResponse({',
        'await finalizeProjectAgentWaitFollowUp({',
        'await checkpointProjectAgentWaitFollowUp({',
      ].join('\n'),
    })).toContain('server continuation must checkpoint the assistant message before final settlement')
  })

  it('rejects model execution before the durable at-most-once fence', () => {
    expect(inspectProjectAgentContinuationContract({
      ...validContract,
      serverFollowUp: [
        'loadProjectAgentWaitContinuationCheckpoint',
        "'x-request-id': params.commandId",
        'await createProjectAgentChatResponse({',
        'await beginProjectAgentWaitContinuationExecution({',
        'await checkpointProjectAgentWaitFollowUp({',
        'await finalizeProjectAgentWaitFollowUp({',
      ].join('\n'),
    })).toContain('server continuation must persist its at-most-once execution fence before invoking the model')
  })
})
