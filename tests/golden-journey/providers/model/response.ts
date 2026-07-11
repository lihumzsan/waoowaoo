import type { ServerResponse } from 'node:http'
import type {
  GoldenChatCompletionRequest,
  GoldenModelDecision,
} from './protocol'

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`)
}

function baseChunk(request: GoldenChatCompletionRequest) {
  return {
    id: 'chatcmpl-golden',
    object: 'chat.completion.chunk',
    created: 1,
    model: request.model,
  }
}

export function writeGoldenStreamingResponse(input: {
  readonly response: ServerResponse
  readonly request: GoldenChatCompletionRequest
  readonly decision: GoldenModelDecision
}): void {
  input.response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  if (input.decision.kind === 'disconnect') {
    input.response.write('data: {"id":"chatcmpl-golden"')
    input.response.destroy()
    return
  }
  writeSse(input.response, {
    ...baseChunk(input.request),
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  })
  if (input.decision.kind === 'text') {
    writeSse(input.response, {
      ...baseChunk(input.request),
      choices: [{ index: 0, delta: { content: input.decision.text }, finish_reason: null }],
    })
    writeSse(input.response, {
      ...baseChunk(input.request),
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })
  } else if (input.decision.kind === 'tool_call') {
    writeSse(input.response, {
      ...baseChunk(input.request),
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: input.decision.toolCallId,
            type: 'function',
            function: { name: input.decision.toolName, arguments: '' },
          }],
        },
        finish_reason: null,
      }],
    })
    writeSse(input.response, {
      ...baseChunk(input.request),
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: input.decision.argumentsJson },
          }],
        },
        finish_reason: null,
      }],
    })
    writeSse(input.response, {
      ...baseChunk(input.request),
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    })
  } else {
    writeSse(input.response, {
      ...baseChunk(input.request),
      choices: [{
        index: 0,
        delta: {
          tool_calls: input.decision.calls.map((call, index) => ({
            index,
            id: call.toolCallId,
            type: 'function',
            function: { name: call.toolName, arguments: call.argumentsJson },
          })),
        },
        finish_reason: null,
      }],
    })
    writeSse(input.response, {
      ...baseChunk(input.request),
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    })
  }
  input.response.write('data: [DONE]\n\n')
  input.response.end()
}

export function writeGoldenJsonResponse(input: {
  readonly response: ServerResponse
  readonly request: GoldenChatCompletionRequest
  readonly decision: GoldenModelDecision
}): void {
  if (input.decision.kind === 'disconnect') {
    input.response.destroy()
    return
  }
  const message = input.decision.kind === 'text'
    ? { role: 'assistant', content: input.decision.text }
    : input.decision.kind === 'tool_call' ? {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: input.decision.toolCallId,
        type: 'function',
        function: {
          name: input.decision.toolName,
          arguments: input.decision.argumentsJson,
        },
      }],
    } : {
      role: 'assistant',
      content: null,
      tool_calls: input.decision.calls.map((call) => ({
        id: call.toolCallId,
        type: 'function',
        function: { name: call.toolName, arguments: call.argumentsJson },
      })),
    }
  input.response.writeHead(200, { 'content-type': 'application/json' })
  input.response.end(JSON.stringify({
    id: 'chatcmpl-golden',
    object: 'chat.completion',
    created: 1,
    model: input.request.model,
    choices: [{
      index: 0,
      message,
      finish_reason: input.decision.kind === 'text' ? 'stop' : 'tool_calls',
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }))
}
