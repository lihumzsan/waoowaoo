import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoldenModelServer } from '../providers/model/server'
import { startGoldenModelServer } from '../providers/model/server'
import {
  decideGoldenModelResponse,
  GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST,
  GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST,
  GOLDEN_FREEFORM_IMAGE_REQUEST,
  GOLDEN_FREEFORM_PARALLEL_CHAPTERS_REQUEST,
  GOLDEN_FREEFORM_RETRY_REQUEST,
  GOLDEN_FREEFORM_SCREENPLAY_REQUEST,
  GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST,
  GOLDEN_FREEFORM_VIDEO_REQUEST,
  GOLDEN_PARALLEL_IMAGE_REQUEST,
} from '../providers/model/policy'
import type { GoldenProviderGateway } from '../providers/gateway'
import { startGoldenProviderGateway } from '../providers/gateway'
import type { GoldenMediaServer } from '../providers/media/server'
import { startGoldenMediaServer } from '../providers/media/server'
import {
  applyGoldenRuntimeIdentity,
  resolveGoldenRuntimeIdentity,
} from '../runtime/identity'

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
  it('keeps one explicit runtime identity across Playwright and its environment process', () => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test' }
    const first = resolveGoldenRuntimeIdentity(environment)
    applyGoldenRuntimeIdentity(first, environment)
    const inherited = resolveGoldenRuntimeIdentity(environment)

    expect(inherited).toEqual(first)
    expect(first.appPort).not.toBe(first.coordinatorPort)
  })

  it('serves a streamed generic Choice tool call over HTTP', async () => {
    runningServer = await startGoldenModelServer()
    const response = await fetch(`${runningServer.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer golden-scenario:free-composition',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'golden-model',
        stream: true,
        messages: [{ role: 'user', content: 'Ask one current question.' }],
        tools: [{
          type: 'function',
          function: {
            name: 'request_choice',
            parameters: {
              type: 'object',
              required: ['subject', 'card', 'commitments'],
              properties: {
                subject: {
                  type: 'object',
                  required: ['kind'],
                  properties: { kind: { type: 'string', enum: ['none'] } },
                },
                card: {
                  type: 'object',
                  required: ['mode', 'replyMode', 'title', 'groups', 'submitLabel'],
                  properties: {
                    mode: { type: 'string', enum: ['confirm'] },
                    replyMode: { type: 'string', enum: ['none'] },
                    title: { type: 'string' },
                    groups: { type: 'array', items: { type: 'object' } },
                    submitLabel: { type: 'string' },
                  },
                },
                commitments: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        }],
      }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(body).toContain('request_choice')
    expect(body).toContain('finish_reason')
    expect(body).toContain('data: [DONE]')
  })

  it('holds text responses behind an explicit observable gate until released', async () => {
    runningServer = await startGoldenModelServer()
    const controlUrl = new URL('/__golden/control', runningServer.baseUrl)
    const enableResponse = await fetch(controlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holdTextResponses: true }),
    })
    expect(enableResponse.status).toBe(200)

    const heldResponse = fetch(`${runningServer.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer golden-scenario:free-composition',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'golden-model',
        messages: [{ role: 'user', content: 'Reply when released.' }],
      }),
    })

    await vi.waitFor(async () => {
      const response = await fetch(controlUrl)
      const snapshot = await response.json() as { heldTextResponseCount?: unknown }
      expect(snapshot.heldTextResponseCount).toBe(1)
    })

    const releaseResponse = await fetch(controlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holdTextResponses: false }),
    })
    expect(releaseResponse.status).toBe(200)
    const response = await heldResponse
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('stable boundary')
  })

  it('routes a free-composition image request directly to create_image', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 1,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: GOLDEN_FREEFORM_IMAGE_REQUEST }],
        tools: [{ type: 'function', function: { name: 'create_image', parameters: { type: 'object' } } }],
      },
    })
    expect(decision).toMatchObject({
      kind: 'tool_call',
      toolName: 'create_image',
      argumentsJson: JSON.stringify({
        request: {
          kind: 'new',
          count: 3,
          prompt: 'A cinematic midnight shrine in mist, wide composition.',
        },
      }),
    })
  })

  it('uses the registered delegate_creative_work name for generic and screenplay delegation', () => {
    const generic = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 2,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: 'Do one bounded professional creative analysis.' }],
        tools: [{ type: 'function', function: { name: 'delegate_creative_work', parameters: { type: 'object' } } }],
      },
    })
    expect(generic).toMatchObject({ kind: 'tool_call', toolName: 'delegate_creative_work' })

    const screenplay = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 3,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: GOLDEN_FREEFORM_SCREENPLAY_REQUEST }],
        tools: [{ type: 'function', function: { name: 'delegate_creative_work', parameters: { type: 'object' } } }],
      },
    })
    expect(screenplay).toMatchObject({ kind: 'tool_call', toolName: 'delegate_creative_work' })
    if (screenplay.kind !== 'tool_call') return
    expect(JSON.parse(screenplay.argumentsJson)).toMatchObject({
      delegation: {
        source: 'requests',
        requests: [{ outputKind: 'screenplay_draft', targetDurationSeconds: 240 }],
      },
    })
  })

  it('reads one professional Skill before returning Creative Worker structured output', () => {
    const responseFormat = {
      type: 'json_schema',
      json_schema: {
        schema: {
          type: 'object',
          required: ['kind'],
          properties: { kind: { type: 'string', const: 'screenplay_draft' } },
        },
      },
    }
    const first = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 4,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: '{"requestedOutputKind":"screenplay_draft"}' }],
        responseFormat,
        tools: [{ type: 'function', function: { name: 'read_skill', parameters: { type: 'object' } } }],
      },
    })
    expect(first).toMatchObject({
      kind: 'tool_call',
      toolName: 'read_skill',
      argumentsJson: JSON.stringify({ skillId: 'story-development' }),
    })

    const afterSkillRead = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 5,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: '{"requestedOutputKind":"screenplay_draft"}' },
          { role: 'assistant', tool_calls: [{ function: { name: 'read_skill' } }] },
          { role: 'tool', content: '{"content":"story skill"}' },
        ],
        responseFormat,
        tools: [{ type: 'function', function: { name: 'read_skill', parameters: { type: 'object' } } }],
      },
    })
    expect(afterSkillRead.kind).toBe('text')
    if (afterSkillRead.kind !== 'text') return
    expect(JSON.parse(afterSkillRead.text)).toMatchObject({
      kind: 'screenplay_draft',
      estimatedDurationSeconds: 240,
    })
  })

  it('authors one current Style Bible Choice with one optional current commitment', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 6,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST },
          { role: 'assistant', tool_calls: [{ function: { name: 'list_resources' } }] },
          { role: 'tool', content: JSON.stringify({ success: true, resources: [{ resource: {
            resourceId: 'style-resource', schemaId: 'project.style_bible', status: 'ready',
            headRevision: { revisionId: 'style-revision', fingerprint: 'f'.repeat(64) },
          } }] }) },
        ],
        tools: [
          { type: 'function', function: { name: 'list_resources', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'request_choice', parameters: { type: 'object' } } },
        ],
      },
    })
    expect(decision).toMatchObject({ kind: 'tool_call', toolName: 'request_choice' })
    if (decision.kind !== 'tool_call') return
    expect(JSON.parse(decision.argumentsJson)).toMatchObject({
      subject: {
        kind: 'resource_revisions',
        revisions: [{ resourceId: 'style-resource', revisionId: 'style-revision' }],
      },
      card: { title: '是否采用当前 Style Bible？' },
      commitments: [{ operationId: 'adopt_style_bible' }],
    })
  })

  it('authors one current ratio Choice and resumes the original media request from the committed fact', () => {
    const tools = [
      { type: 'function' as const, function: { name: 'request_choice', parameters: { type: 'object' } } },
      { type: 'function' as const, function: { name: 'create_image', parameters: { type: 'object' } } },
    ]
    const awaitingRatio = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 7,
      request: {
        model: 'golden-model',
        messages: [
          {
            role: 'system',
            content: [{
              type: 'text',
              text: '[project_state_snapshot]\nconfig.videoRatio=none\n[/project_state_snapshot]',
            }],
          },
          { role: 'user', content: GOLDEN_FREEFORM_IMAGE_REQUEST },
        ],
        tools,
      },
    })
    expect(awaitingRatio).toMatchObject({ kind: 'tool_call', toolName: 'request_choice' })
    if (awaitingRatio.kind !== 'tool_call') return
    expect(JSON.parse(awaitingRatio.argumentsJson)).toMatchObject({
      subject: { kind: 'none' },
      card: {
        title: '请选择当前项目的画面比例',
        groups: [{ key: 'videoRatio', presentation: 'aspect_ratio' }],
        submitLabel: '保存本次画面比例',
      },
      commitments: [
        { operationId: 'update_project_config', inputJson: JSON.stringify({ videoRatio: '16:9' }) },
        { operationId: 'update_project_config', inputJson: JSON.stringify({ videoRatio: '9:16' }) },
        { operationId: 'update_project_config', inputJson: JSON.stringify({ videoRatio: '21:9' }) },
      ],
    })

    const afterRatio = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 8,
      request: {
        model: 'golden-model',
        messages: [
          {
            role: 'system',
            content: [{
              type: 'text',
              text: '[project_state_snapshot]\nconfig.videoRatio=16:9\n[/project_state_snapshot]',
            }],
          },
          { role: 'user', content: GOLDEN_FREEFORM_IMAGE_REQUEST },
          { role: 'assistant', tool_calls: [{ function: { name: 'request_choice' } }] },
          { role: 'tool', content: JSON.stringify({ ok: true, data: { emitted: true } }) },
        ],
        tools,
      },
    })
    expect(afterRatio).toMatchObject({ kind: 'tool_call', toolName: 'create_image' })
  })

  it('passes the exact screenplay revision into chapter_plan Creative Work', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 7,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST },
          { role: 'assistant', tool_calls: [{ function: { name: 'list_resources' } }] },
          { role: 'tool', content: JSON.stringify({ success: true, resources: [{ resource: {
            resourceId: 'screenplay-resource', schemaId: 'project.source_script', status: 'ready',
            headRevision: {
              revisionId: 'screenplay-revision',
              fingerprint: 'a'.repeat(64),
              content: { kind: 'text', text: 'A sufficiently long screenplay source.' },
            },
          } }] }) },
        ],
        tools: [
          { type: 'function', function: { name: 'list_resources', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'delegate_creative_work', parameters: { type: 'object' } } },
        ],
      },
    })
    expect(decision).toMatchObject({ kind: 'tool_call', toolName: 'delegate_creative_work' })
    if (decision.kind !== 'tool_call') return
    expect(JSON.parse(decision.argumentsJson)).toMatchObject({
      delegation: {
        requests: [{
          outputKind: 'chapter_plan',
          context: { sourceMaterials: [{ provenance: {
            kind: 'resource',
            resourceId: 'screenplay-resource',
            revisionId: 'screenplay-revision',
            fingerprint: 'a'.repeat(64),
          } }] },
        }],
      },
    })
  })

  it('turns exact adopted Chapter identities into one parallel Creative Work delegation', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 8,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: GOLDEN_FREEFORM_PARALLEL_CHAPTERS_REQUEST },
          { role: 'assistant', tool_calls: [{ function: { name: 'get_project_context' } }] },
          { role: 'tool', content: JSON.stringify({ ok: true, data: { chapters: [
            { id: 'chapter-2', chapterIndex: 1, targetDurationSec: 120 },
            { id: 'chapter-1', chapterIndex: 0, targetDurationSec: 120 },
          ] } }) },
        ],
        tools: [
          { type: 'function', function: { name: 'get_project_context', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'delegate_creative_work', parameters: { type: 'object' } } },
        ],
      },
    })
    expect(decision).toMatchObject({ kind: 'tool_call', toolName: 'delegate_creative_work' })
    if (decision.kind !== 'tool_call') return
    expect(JSON.parse(decision.argumentsJson)).toEqual({
      delegation: {
        source: 'chapters',
        chapters: [
          { chapterId: 'chapter-1', requestKey: 'golden-continuity-chapter-1' },
          { chapterId: 'chapter-2', requestKey: 'golden-continuity-chapter-2' },
        ],
        outputKind: 'continuity_analysis',
        goal: 'Analyze each adopted production Chapter independently while preserving shared story continuity.',
        userRequest: GOLDEN_FREEFORM_PARALLEL_CHAPTERS_REQUEST,
        constraints: [
          'Use the exact server-compiled Chapter scope.',
          'Report continuity facts and transitions without changing the Chapter boundary.',
        ],
        referencedAssets: [],
      },
    })
  })

  it('adopts exact screenplay and chapter_plan revisions without a workflow stage', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 8,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST },
          { role: 'assistant', tool_calls: [{ function: { name: 'list_resources' } }] },
          { role: 'tool', content: JSON.stringify({ success: true, resources: [
            { resource: {
              resourceId: 'screenplay-resource', schemaId: 'project.source_script', status: 'ready',
              scope: { episodeId: 'episode-1' },
              headRevision: { revisionId: 'screenplay-revision', fingerprint: 'a'.repeat(64) },
            } },
            { resource: {
              resourceId: 'chapter-resource', schemaId: 'project.chapter_plan', status: 'ready',
              scope: { episodeId: 'episode-1' },
              headRevision: { revisionId: 'chapter-revision', fingerprint: 'b'.repeat(64) },
            } },
          ] }) },
        ],
        tools: [
          { type: 'function', function: { name: 'list_resources', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'adopt_chapters', parameters: { type: 'object' } } },
        ],
      },
    })
    expect(decision).toMatchObject({ kind: 'tool_call', toolName: 'adopt_chapters' })
    if (decision.kind !== 'tool_call') return
    expect(JSON.parse(decision.argumentsJson)).toEqual({
      screenplay: {
        resourceId: 'screenplay-resource',
        revisionId: 'screenplay-revision',
        fingerprint: 'a'.repeat(64),
      },
      chapterPlan: {
        resourceId: 'chapter-resource',
        revisionId: 'chapter-revision',
        fingerprint: 'b'.repeat(64),
      },
    })
  })

  it('emits three distinct calls to the same independent Operation for a parallel request', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'parallel-operation-batch',
      requestOrdinal: 2,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: GOLDEN_PARALLEL_IMAGE_REQUEST }],
        tools: [{ type: 'function', function: { name: 'create_image', parameters: { type: 'object' } } }],
      },
    })
    expect(decision.kind).toBe('tool_calls')
    if (decision.kind !== 'tool_calls') return
    expect(decision.calls).toHaveLength(3)
    expect(new Set(decision.calls.map((call) => call.toolCallId)).size).toBe(3)
    expect(decision.calls.every((call) => call.toolName === 'create_image')).toBe(true)
    expect(decision.calls.map((call) => JSON.parse(call.argumentsJson))).toEqual([
      expect.objectContaining({ request: expect.not.objectContaining({ schemaId: expect.anything() }) }),
      expect.objectContaining({ request: expect.not.objectContaining({ schemaId: expect.anything() }) }),
      expect.objectContaining({ request: expect.not.objectContaining({ schemaId: expect.anything() }) }),
    ])

    const continuationDecision = decideGoldenModelResponse({
      scenarioId: 'parallel-operation-batch',
      requestOrdinal: 3,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: GOLDEN_PARALLEL_IMAGE_REQUEST },
          { role: 'user', content: '[task_update]\noperation=create_image\nstatus=completed\ntotal=3 succeeded=3 failed=0' },
        ],
        tools: [{ type: 'function', function: { name: 'create_image', parameters: { type: 'object' } } }],
      },
    })
    expect(continuationDecision.kind).toBe('text')
  })

  it('reports a Task continuation without repeating the original tool', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 4,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: GOLDEN_FREEFORM_IMAGE_REQUEST },
          { role: 'user', content: '[task_update]\noperation=create_image\nstatus=partial\ntotal=3 succeeded=1 failed=2' },
        ],
        tools: [{ type: 'function', function: { name: 'create_image', parameters: { type: 'object' } } }],
      },
    })
    expect(decision).toMatchObject({ kind: 'text' })
  })

  it('retries only Resource identities returned as failed by list_resources', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 5,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: GOLDEN_FREEFORM_RETRY_REQUEST },
          { role: 'assistant', tool_calls: [{ function: { name: 'list_resources' } }] },
          {
            role: 'tool',
            content: JSON.stringify({ success: true, resources: [{ resource: {
              resourceId: 'failed-resource-1', mediaType: 'image', status: 'failed', headRevision: null,
            } }] }),
          },
        ],
        tools: [
          { type: 'function', function: { name: 'list_resources', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'create_image', parameters: { type: 'object' } } },
        ],
      },
    })
    expect(decision).toMatchObject({
      kind: 'tool_call',
      toolName: 'create_image',
      argumentsJson: JSON.stringify({
        request: { kind: 'retry', resourceIds: ['failed-resource-1'] },
      }),
    })
  })

  it('passes exact listed image revisions into video generation', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'free-composition',
      requestOrdinal: 6,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: GOLDEN_FREEFORM_VIDEO_REQUEST },
          { role: 'assistant', tool_calls: [{ function: { name: 'list_resources' } }] },
          {
            role: 'tool',
            content: JSON.stringify({ success: true, resources: [{ resource: {
              resourceId: 'image-resource-1', mediaType: 'image', status: 'ready',
              headRevision: { revisionId: 'image-revision-1', fingerprint: 'f'.repeat(64) },
            } }] }),
          },
        ],
        tools: [
          { type: 'function', function: { name: 'list_resources', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'create_video', parameters: { type: 'object' } } },
        ],
      },
    })
    expect(decision).toMatchObject({ kind: 'tool_call', toolName: 'create_video' })
    if (decision.kind !== 'tool_call') return
    expect(JSON.parse(decision.argumentsJson)).toMatchObject({
      request: {
        kind: 'new',
        count: 2,
        mediaReferences: [{
          resourceId: 'image-resource-1',
          revisionId: 'image-revision-1',
          fingerprint: 'f'.repeat(64),
        }],
      },
    })
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

  it('returns schema-shaped JSON for Creative Worker structured output requests', async () => {
    runningServer = await startGoldenModelServer()
    const response = await fetch(`${runningServer.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer golden-scenario:free-composition',
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
          authorization: 'Bearer golden-scenario:free-composition',
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
