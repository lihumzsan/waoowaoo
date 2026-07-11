import { describe, expect, it } from 'vitest'
import { inspectProjectAgentContinuationContract } from '../../../scripts/guards/single-project-agent-continuation.mjs'

const validContract = {
  productionSources: '',
  continuationCallers: ['src/lib/workers/outbox.worker.ts'],
  outboxWorker: 'await runProjectAgentWaitContinuationCommand(payload, outboxId)',
  serverFollowUp: [
    'loadProjectAgentContinuationCheckpoint',
    "'x-request-id': params.commandId",
    'await beginProjectAgentWaitContinuationExecution({',
    'await createProjectAgentChatResponse({',
    'await settleProjectAgentContinuationTerminalHandoff({',
    'await finalizeProjectAgentContinuationHandoff({',
  ].join('\n'),
  executionHandoff: [
    'projectAgentContinuationCheckpoint.findUnique',
    'projectAgentContinuationCheckpoint.updateMany',
    'appendProjectAssistantThreadMessagesInTransaction',
    'appendProjectAgentEventsInTransaction',
    'PROJECT_AGENT_CONTINUATION_CHECKPOINT_MISSING',
    "status: 'running'",
    "status: 'settled'",
    'prisma.$transaction',
  ].join('\n'),
  publicControl: '',
  externalExecutors: '',
}

describe('single Project Agent continuation guard', () => {
  it('accepts the outbox-only atomic execution-handoff path', () => {
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

  it('rejects the retired split checkpoint settlement path', () => {
    expect(inspectProjectAgentContinuationContract({
      ...validContract,
      serverFollowUp: [
        'loadProjectAgentContinuationCheckpoint',
        "'x-request-id': params.commandId",
        'await beginProjectAgentWaitContinuationExecution({',
        'await createProjectAgentChatResponse({',
        'await checkpointProjectAgentWaitFollowUp({',
      ].join('\n'),
    })).toContain('server continuation must not restore split checkpoint settlement: checkpointProjectAgentWaitFollowUp')
  })

  it('rejects model execution before the durable at-most-once fence', () => {
    expect(inspectProjectAgentContinuationContract({
      ...validContract,
      serverFollowUp: [
        'loadProjectAgentContinuationCheckpoint',
        "'x-request-id': params.commandId",
        'await createProjectAgentChatResponse({',
        'await beginProjectAgentWaitContinuationExecution({',
        'await settleProjectAgentContinuationTerminalHandoff({',
        'await finalizeProjectAgentContinuationHandoff({',
      ].join('\n'),
    })).toContain('server continuation must persist its at-most-once execution fence before invoking the model')
  })
})
