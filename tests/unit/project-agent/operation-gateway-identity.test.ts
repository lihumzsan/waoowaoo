import { describe, expect, it } from 'vitest'
import {
  readProjectAgentOperationGatewayInput,
  resolveProjectAgentOperationGatewayToolIdentity,
} from '@/lib/project-agent/agents-tool-adapter'

describe('project agent operation gateway identity', () => {
  it('keeps the outer Operation identity when the nested arguments JSON is malformed', () => {
    const toolInput = {
      operationId: 'delegate_creative_work',
      contractId: 'contract-1',
      argumentsJson: '{"goal":"prepare the video","context":{"constraints":[],"requestKey":"request-1"}',
    }

    expect(resolveProjectAgentOperationGatewayToolIdentity(toolInput))
      .toBe('delegate_creative_work')
    expect(() => readProjectAgentOperationGatewayInput(toolInput))
      .toThrow('PROJECT_AGENT_OPERATION_GATEWAY_ARGUMENTS_JSON_INVALID:delegate_creative_work')
  })

  it('uses the gateway identity only when the outer Operation identity is unavailable', () => {
    expect(resolveProjectAgentOperationGatewayToolIdentity({
      contractId: 'contract-1',
      argumentsJson: '{}',
    })).toBe('execute_operation')
  })
})
