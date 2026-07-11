import { afterEach, describe, expect, it } from 'vitest'
import type { GoldenModelServer } from '../providers/model/server'
import { startGoldenModelServer } from '../providers/model/server'
import { decideGoldenModelResponse } from '../providers/model/policy'
import type { GoldenProviderGateway } from '../providers/gateway'
import { startGoldenProviderGateway } from '../providers/gateway'
import type { GoldenMediaServer } from '../providers/media/server'
import { startGoldenMediaServer } from '../providers/media/server'

let runningServer: GoldenModelServer | null = null
let mediaServer: GoldenMediaServer | null = null
let gateway: GoldenProviderGateway | null = null

afterEach(async () => {
  await runningServer?.close()
  await gateway?.close()
  await mediaServer?.close()
  runningServer = null
  gateway = null
  mediaServer = null
})

describe('Golden local model provider', () => {
  it('honors the script-intake JSON contract when production expresses it only in the prompt', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 1,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: '你负责扩写前创作问诊。只输出包含 "questions" 和 targetRuntime 的 JSON。',
        }],
      },
    })
    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const parsed = JSON.parse(decision.text) as { questions: Array<{ key: string }> }
    expect(parsed.questions.some((question) => question.key === 'targetRuntime')).toBe(true)
  })

  it('honors the streamed source-script JSON contract expressed only in the prompt', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 1,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: '把用户的故事创意扩写成完整、连贯、可拍摄的剧本。只输出 {"segments":[{"episodeIndex":0}]}。',
        }],
      },
    })
    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const parsed = JSON.parse(decision.text) as { segments: unknown[] }
    expect(parsed.segments).toHaveLength(1)
  })

  it('serves a streamed OpenAI-compatible tool call over HTTP', async () => {
    runningServer = await startGoldenModelServer()
    const response = await fetch(`${runningServer.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer golden-scenario:normal-mainline',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'golden-model',
        stream: true,
        messages: [{ role: 'user', content: 'A story' }],
        tools: [{
          type: 'function',
          function: { name: 'request_script_intake_choice', parameters: { type: 'object' } },
        }],
      }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(body).toContain('request_script_intake_choice')
    expect(body).toContain('finish_reason')
    expect(body).toContain('data: [DONE]')
  })

  it('derives tool argument keys from the production-supplied schema', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 2,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: 'Continue' }],
        tools: [{
          type: 'function',
          function: {
            name: 'ingest_script',
            parameters: {
              type: 'object',
              required: ['sourceKind', 'text'],
              properties: {
                sourceKind: { type: 'string', enum: ['paste', 'prompt_generated_outline'] },
                text: { type: 'string' },
              },
            },
          },
        }],
      },
    })
    expect(decision.kind).toBe('tool_call')
    if (decision.kind !== 'tool_call') return
    expect(JSON.parse(decision.argumentsJson)).toEqual({
      sourceKind: 'prompt_generated_outline',
      text: 'A deterministic folk-horror story about a lost traveler, a forbidden shrine, and a closed-loop ending.',
    })
  })

  it('emits two real tool calls for the duplicate-delivery scenario', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'duplicate-tool-call',
      requestOrdinal: 1,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: 'Continue' }],
        tools: [{
          type: 'function',
          function: { name: 'request_script_intake_choice', parameters: { type: 'object' } },
        }],
      },
    })
    expect(decision.kind).toBe('tool_calls')
    if (decision.kind !== 'tool_calls') return
    expect(decision.calls).toHaveLength(2)
    expect(new Set(decision.calls.map((call) => call.toolCallId)).size).toBe(2)
    expect(decision.calls.every((call) => call.toolName === 'request_script_intake_choice')).toBe(true)
  })

  it('forces the declared stage-probe operation without changing production tool schemas', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-stage-probe',
      requestOrdinal: 1,
      forcedToolName: 'ingest_script',
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: 'Continue' }],
        tools: [
          { type: 'function', function: { name: 'request_script_intake_choice', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'ingest_script', parameters: { type: 'object' } } },
        ],
      },
    })
    expect(decision.kind).toBe('tool_call')
    if (decision.kind !== 'tool_call') return
    expect(decision.toolName).toBe('ingest_script')
  })

  it('rejects requests without an explicit scenario API key', async () => {
    runningServer = await startGoldenModelServer()
    const response = await fetch(`${runningServer.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'golden-model', messages: [] }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'GOLDEN_MODEL_SCENARIO_API_KEY_REQUIRED' },
    })
  })

  it('returns schema-shaped JSON for real worker structured output requests', async () => {
    runningServer = await startGoldenModelServer()
    const response = await fetch(`${runningServer.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer golden-scenario:normal-mainline',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'golden-model',
        messages: [{ role: 'user', content: 'Build structured output' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            schema: {
              type: 'object',
              required: ['title', 'items'],
              properties: {
                title: { type: 'string' },
                items: { type: 'array', minItems: 2, items: { type: 'integer', minimum: 3 } },
              },
            },
          },
        },
      }),
    })
    const result = await response.json() as { choices: Array<{ message: { content: string } }> }

    expect(JSON.parse(result.choices[0]?.message.content ?? '')).toEqual({
      title: 'golden-test-value',
      items: [3, 3],
    })
  })

  it('streams model calls and media bytes through one provider base URL', async () => {
    runningServer = await startGoldenModelServer()
    mediaServer = await startGoldenMediaServer()
    gateway = await startGoldenProviderGateway({
      modelBaseUrl: runningServer.baseUrl.replace(/\/v1$/, ''),
      mediaBaseUrl: mediaServer.baseUrl,
    })
    const [completion, media] = await Promise.all([
      fetch(`${gateway.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer golden-scenario:normal-mainline',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'golden-model', stream: true, messages: [] }),
      }),
      fetch(`${gateway.baseUrl}/assets/golden.mp4`),
    ])

    expect(await completion.text()).toContain('data: [DONE]')
    expect(media.headers.get('content-type')).toBe('video/mp4')
  })
})
