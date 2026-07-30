import { describe, expect, it } from 'vitest'
import {
  PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA,
  readProjectAgentOperationGatewayInput,
  resolveProjectAgentOperationGatewayToolIdentity,
} from '@/lib/project-agent/agents-tool-adapter'

describe('project agent operation gateway identity', () => {
  it('keeps the outer Operation identity when the nested arguments JSON is malformed', () => {
    const toolInput = {
      operationId: 'delegate_creative_work',
      argumentsJson: '{"goal":"prepare the video","context":{"constraints":[],"requestKey":"request-1"}',
    }

    expect(resolveProjectAgentOperationGatewayToolIdentity(toolInput))
      .toBe('delegate_creative_work')
    expect(() => readProjectAgentOperationGatewayInput(toolInput))
      .toThrow('PROJECT_AGENT_OPERATION_GATEWAY_ARGUMENTS_JSON_INVALID:delegate_creative_work')
  })

  it('uses the gateway identity only when the outer Operation identity is unavailable', () => {
    expect(resolveProjectAgentOperationGatewayToolIdentity({
      argumentsJson: '{}',
    })).toBe('execute_operation')
  })

  it('uses one fixed gateway envelope for every on-demand Operation', () => {
    expect(Object.keys(PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA.properties).sort())
      .toEqual(['argumentsJson', 'operationId'])
    expect(PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA.required.sort())
      .toEqual(['argumentsJson', 'operationId'])
    expect(readProjectAgentOperationGatewayInput({
      operationId: 'generate_voice',
      argumentsJson: '{"request":{"kind":"single"}}',
    })).toEqual({
      operationId: 'generate_voice',
      arguments: { request: { kind: 'single' } },
    })
  })
})
