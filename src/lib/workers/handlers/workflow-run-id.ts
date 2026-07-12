type WorkflowPayload = Record<string, unknown>

function readRunId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function resolveWorkflowRunId(params: {
  payload: WorkflowPayload
  taskId: string
  findRunIdByTaskId: (taskId: string) => Promise<string | null>
}): Promise<string> {
  const directRunId = readRunId(params.payload.runId)
  if (directRunId) return directRunId

  const meta = params.payload.meta
  const metaRunId = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? readRunId((meta as WorkflowPayload).runId)
    : ''
  if (metaRunId) return metaRunId

  return readRunId(await params.findRunIdByTaskId(params.taskId))
}
