export function buildTaskMediaLogicalInvocationIdentity(input: {
  readonly taskId: string
  readonly invocationKey: string
}): string {
  const invocationKey = input.invocationKey.trim()
  if (!invocationKey) throw new Error('PROVIDER_INVOCATION_KEY_REQUIRED')
  return `task:${input.taskId}:${invocationKey}`
}
