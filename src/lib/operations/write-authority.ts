export function assertAssistantToolWriteAuthority(
  operationId: string,
  operation: Record<string, unknown>,
): void {
  const channels = operation.channels as { tool?: unknown } | undefined
  const effects = operation.effects as { writes?: unknown } | undefined
  const authority = operation.assistantWriteAuthority as {
    kind?: unknown
  } | undefined
  const toolWrite = channels?.tool === true && effects?.writes === true

  if (!toolWrite) {
    if (authority !== undefined) {
      throw new Error(`PROJECT_AGENT_OPERATION_WRITE_AUTHORITY_NOT_APPLICABLE:${operationId}`)
    }
    return
  }

  const confirmation = operation.confirmation as { kind?: unknown } | undefined
  if (confirmation?.kind === 'billable_media') {
    if (authority !== undefined) {
      throw new Error(`PROJECT_AGENT_OPERATION_WRITE_AUTHORITY_CONFLICT:${operationId}:billable_plan_commit`)
    }
    return
  }

  if (typeof operation.executeInTransaction === 'function') {
    if (authority !== undefined) {
      throw new Error(`PROJECT_AGENT_OPERATION_WRITE_AUTHORITY_CONFLICT:${operationId}:transactional_execute`)
    }
    return
  }

  if (authority?.kind === 'transactional_task_submission') {
    if (typeof operation.execute !== 'function') {
      throw new Error(`PROJECT_AGENT_OPERATION_TASK_SUBMISSION_EXECUTOR_REQUIRED:${operationId}`)
    }
    return
  }

  throw new Error(`PROJECT_AGENT_OPERATION_TOOL_WRITE_AUTHORITY_REQUIRED:${operationId}`)
}
