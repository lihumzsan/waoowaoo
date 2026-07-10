export interface ProjectAgentRunFence {
  runId: string
  runVersion: number
  eventSeq: string
}

export function createInitialProjectAgentRunFence(runId: string): ProjectAgentRunFence {
  const normalizedRunId = runId.trim()
  if (!normalizedRunId) throw new Error('PROJECT_AGENT_RUN_FENCE_RUN_ID_REQUIRED')
  return {
    runId: normalizedRunId,
    runVersion: 0,
    eventSeq: '0',
  }
}

export function createProjectAgentRunFence(input: {
  id: string
  runVersion: number
  eventSeq: bigint | string
}): ProjectAgentRunFence {
  if (!Number.isInteger(input.runVersion) || input.runVersion < 0) {
    throw new Error(`PROJECT_AGENT_RUN_VERSION_INVALID:${String(input.runVersion)}`)
  }
  return {
    runId: input.id,
    runVersion: input.runVersion,
    eventSeq: typeof input.eventSeq === 'bigint' ? input.eventSeq.toString() : input.eventSeq,
  }
}

export function advanceProjectAgentRunFence(
  fence: ProjectAgentRunFence,
  eventSeq: bigint,
): ProjectAgentRunFence {
  return {
    runId: fence.runId,
    runVersion: fence.runVersion + 1,
    eventSeq: eventSeq.toString(),
  }
}

export function assignProjectAgentRunFence(
  target: ProjectAgentRunFence,
  source: ProjectAgentRunFence,
): void {
  if (target.runId !== source.runId) {
    throw new Error(`PROJECT_AGENT_RUN_FENCE_ID_MISMATCH expected=${target.runId} actual=${source.runId}`)
  }
  target.runVersion = source.runVersion
  target.eventSeq = source.eventSeq
}
