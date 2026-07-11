import { ApiError } from '@/lib/api-errors'
import type { ProjectAgentOperationDefinition } from './types'

export type OperationInvocationChannel = 'api' | 'tool'

export function assertOperationChannelAllowed(
  operation: ProjectAgentOperationDefinition,
  channel: OperationInvocationChannel,
): void {
  if (operation.channels[channel]) return
  throw new ApiError('FORBIDDEN', {
    code: 'OPERATION_NOT_ALLOWED',
    operationId: operation.id,
    channel,
    message: `operation ${operation.id} is not available through the ${channel} channel`,
  })
}
