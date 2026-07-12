import { afterEach, describe, expect, it } from 'vitest'
import type { GoldenModelServer } from '../providers/model/server'
import { startGoldenModelServer } from '../providers/model/server'
import { decideGoldenModelResponse } from '../providers/model/policy'
import type { GoldenProviderGateway } from '../providers/gateway'
import { startGoldenProviderGateway } from '../providers/gateway'
import type { GoldenMediaServer } from '../providers/media/server'
import { startGoldenMediaServer } from '../providers/media/server'
import {
  normalizeRawBeatSheet,
  normalizeRawEditBible,
  normalizeRawEmotionalCurve,
  normalizeRawLedger,
} from '@/lib/edit-bible/source-anchor-normalization'
import { validateEditBibleBundle } from '@/lib/edit-bible/cross-check'
import { buildEditSourceBlocks, formatEditSourceBlocksForPrompt } from '@/lib/edit-source-document'
import { editStylePreviewOptionsSchema } from '@/lib/edit-script/types'
import { editScriptCoreSchema } from '@/lib/edit-script/types'
import { normalizeEditShotExecutionPlan } from '@/lib/edit-script/normalize'
import { buildShotExecutionPlanPromptStructure } from '@/lib/edit-script/shot-execution-plan-prompt'
import { normalizeChapterPlanOutput } from '@/lib/edit-chapter'
import { parseLocationCandidatePrompt } from '@/lib/asset-generation/location-candidate-prompts'
import { parseLocationSpatialProfile } from '@/lib/location-spatial-profile/types'
import { bgmScorePlanSchema } from '@/lib/bgm-score/types'
import { soundscapeRawPlanSchema } from '@/lib/soundscape/types'
import { resolveSoundscapePlanReferences } from '@/lib/soundscape/plan-contract'
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

  it('returns one cross-consistent production edit-bible bundle across four prompt-only calls', () => {
    const sourceText = '暮色压住荒野。旅人走到废弃祭坛前，转身逃跑后又回到同一座祭坛。'
    const blocks = buildEditSourceBlocks(sourceText)
    const source = formatEditSourceBlocksForPrompt(blocks)
    const decide = (contract: string): unknown => {
      const decision = decideGoldenModelResponse({
        scenarioId: 'normal-mainline',
        requestOrdinal: 1,
        request: {
          model: 'golden-model',
          messages: [{ role: 'user', content: `${contract}\n\n${source}\n\n原文长度：${String(sourceText.length)}` }],
        },
      })
      expect(decision.kind).toBe('text')
      if (decision.kind !== 'text') throw new Error('GOLDEN_EDIT_BIBLE_TEXT_REQUIRED')
      return JSON.parse(decision.text) as unknown
    }
    const bible = normalizeRawEditBible({
      raw: decide('{"voiceProfile":"固有声线","worldRules":[]}'),
    })
    const beatSheet = normalizeRawBeatSheet({
      raw: decide('{"beatId":"beat_001","estimatedDurationSec":30,"sourceAnchor":{}}'),
      sourceText,
      blocks,
    })
    const ledger = normalizeRawLedger({
      raw: decide('{"eventId":"event_001","beatId":"beat_001","persistentFacts":[]}'),
      beatSheet,
    })
    const emotionalCurve = normalizeRawEmotionalCurve({
      raw: decide('{"cueId":"cue_001","musicPolicy":"underscore","sourceAnchor":{}}'),
      sourceText,
      blocks,
    })

    expect(validateEditBibleBundle({
      bundle: { bible, beatSheet, ledger, emotionalCurve },
      sourceText,
    })).toMatchObject({
      bible: { title: '禁坛归途' },
      beatSheet: { beats: [{ beatId: 'beat_001' }] },
      ledger: { events: [{ eventId: 'event_001' }] },
      emotionalCurve: { cues: [{ cueId: 'cue_001' }] },
    })
  })

  it('routes the prompt-only style-options contract before embedded Bible fields', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 1,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: '{"voiceProfile":"固有声线","worldRules":[],"stylePreviews":[{"stylePolicy":{},"gridImagePrompt":"string"}]}',
        }],
      },
    })

    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    expect(editStylePreviewOptionsSchema.parse(JSON.parse(decision.text)).stylePreviews).toHaveLength(3)
  })

  it('uses exact production asset identities in the prompt-only core edit plan', () => {
    const assetMenu = {
      locations: [{ id: 'location-real-1', name: '废弃祭坛', description: '循环发生地' }],
      characters: [{ id: 'character-real-1', name: '旅人', description: '受困主角' }],
    }
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 19,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: `已确认资产菜单：\n${JSON.stringify(assetMenu)}\n\n只输出包含 "shotPurpose" 和 "generationSegments" 的 JSON。`,
        }],
      },
    })

    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const rawPlan = JSON.parse(decision.text) as unknown
    expect(JSON.stringify(rawPlan)).not.toContain('location-real-1')
    expect(JSON.stringify(rawPlan)).not.toContain('character-real-1')
    const normalized = normalizeChapterPlanOutput(rawPlan, assetMenu)
    expect(normalized.shots).toHaveLength(3)
    expect(normalized.shots[1]?.scene.locationId).toBe('location-real-1')
    expect(normalized.shots[1]?.characters[0]?.characterId).toBe('character-real-1')
  })

  it('honors the production location candidate JSON contract expressed only in the prompt', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 20,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: '【场景生成要求（用于出图，中文描述）】\n请把结果转换成一条最终可复用场景资产图片提示词。\n只输出 JSON：{"prompt":"最终图片生成提示词"}。',
        }],
      },
    })

    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const prompt = parseLocationCandidatePrompt(JSON.parse(decision.text) as Record<string, unknown>)
    expect(prompt).toContain('废弃祭坛')
    expect(prompt).toContain('前景')
    expect(prompt).not.toContain('旅人')
  })

  it('honors the production location spatial-profile vision contract expressed only in the prompt', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 21,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: '你负责分析场景图片的空间结构。只输出 {"sceneSummary": "string", "anchors": []}。',
            },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,Z29sZGVu' },
            },
          ],
        }],
      },
    })

    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const profile = parseLocationSpatialProfile(JSON.parse(decision.text) as unknown)
    expect(profile.anchors.length).toBeGreaterThan(0)
    expect(profile.depthLayout.midground).toContain('祭台')
  })

  it('covers the exact production shots and segments in the prompt-only shot execution plan', () => {
    const core = editScriptCoreSchema.parse({
      shots: [
        {
          shotId: 'shot-real-1',
          shotNumber: 1,
          shotPurpose: 'establishing',
          durationSec: 4,
          scene: { locationId: 'location-real-1', name: '废弃祭坛', subScene: '祭坛全貌' },
          action: '暮色笼罩祭坛。',
          characters: [],
          keyObjects: [{ name: '祭坛石碑', role: '空间地标' }],
          dialogue: [],
          sound: '一次短促石块碰撞声。',
        },
        {
          shotId: 'shot-real-2',
          shotNumber: 2,
          shotPurpose: 'action',
          durationSec: 4,
          scene: { locationId: 'location-real-1', name: '废弃祭坛', subScene: '石碑旁' },
          action: '旅人靠近石碑。',
          characters: [{
            characterId: 'character-real-1',
            name: '旅人',
            visibility: 'visible',
            role: 'focus',
            performance: '谨慎靠近',
          }],
          keyObjects: [{ name: '石碑', role: '异常规则载体' }],
          dialogue: [],
          sound: '一次脚步声。',
        },
      ],
      generationSegments: [{
        shotIds: ['shot-real-1', 'shot-real-2'],
        continuity: '共享祭坛空间与连续动作。',
      }],
    })
    const productionPromptInput = buildShotExecutionPlanPromptStructure({
      durationSec: 8,
      shotCount: 2,
      sourceText: null,
      shots: core.shots,
      generationSegments: core.generationSegments,
    })
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 22,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: `核心剪辑计划：\n${JSON.stringify(productionPromptInput)}\n\n只输出包含 "generationSegmentExecutions" 和 "continuousVideoPrompt" 的 JSON。`,
        }],
      },
    })

    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const normalized = normalizeEditShotExecutionPlan(
      JSON.parse(decision.text),
      core.shots,
      core.generationSegments,
    )
    expect(normalized.shots.map((shot) => shot.shotId)).toEqual(['shot-real-1', 'shot-real-2'])
    expect(normalized.generationSegmentExecutions[0]?.shotIds).toEqual(['shot-real-1', 'shot-real-2'])
  })

  it('honors the production BGM score plan contract expressed only in the prompt', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 23,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: 'Required JSON shape:\n{"durationSeconds":12,"creativeBrief":{},"scoreDesign":{},"virtualLayers":[],"promptSections":[],"finalPrompt":"string"}\n只返回严格 JSON。',
        }],
      },
    })

    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const plan = bgmScorePlanSchema.parse(JSON.parse(decision.text))
    expect(plan.durationSeconds).toBe(12)
    expect(plan.finalPrompt.length).toBeGreaterThanOrEqual(80)
    expect(plan.scoreDesign.sections).toHaveLength(1)
  })

  it('uses short clip orders in the production soundscape model contract', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 24,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: 'Required JSON shape: {"environmentFingerprint":"string","transitionIn":"fade"}\nFinal rendered media timeline JSON:\n[{"clipOrder":1,"shotNumbers":[1]},{"clipOrder":2,"shotNumbers":[2]}]',
        }],
      },
    })

    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const rawPlan = soundscapeRawPlanSchema.parse(JSON.parse(decision.text))
    expect(rawPlan.sections[0]).toMatchObject({
      fromClipOrder: 1,
      toClipOrder: 2,
    })
    const plan = resolveSoundscapePlanReferences(rawPlan, [
      {
        panelId: 'panel-1',
        groupId: null,
        sourceKind: 'panel',
        source: 'clip-1.mp4',
        durationSeconds: 4,
        order: 1,
        shotNumber: 1,
        shotNumbers: [1],
        shotId: 'shot-real-1',
        shotIds: ['shot-real-1'],
        description: null,
        sound: null,
      },
      {
        panelId: 'panel-2',
        groupId: null,
        sourceKind: 'panel',
        source: 'clip-2.mp4',
        durationSeconds: 4,
        order: 2,
        shotNumber: 2,
        shotNumbers: [2],
        shotId: 'shot-real-2',
        shotIds: ['shot-real-2'],
        description: null,
        sound: null,
      },
    ])
    expect(plan.sections[0]).toMatchObject({
      fromShotId: 'shot-real-1',
      toShotId: 'shot-real-2',
    })
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

  it('does not let an old prompt-only contract override the currently available workflow tool', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 3,
      request: {
        model: 'golden-model',
        messages: [
          { role: 'user', content: '{"voiceProfile":"固有声线","worldRules":[]}' },
          { role: 'user', content: 'Continue the current workflow.' },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'generate_edit_style_previews',
            parameters: { type: 'object', properties: {} },
          },
        }],
      },
    })

    expect(decision).toMatchObject({
      kind: 'tool_call',
      toolName: 'generate_edit_style_previews',
    })
  })

  it('uses the live workflow stage to raise the user Choice after asynchronous style tasks finish', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 16,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'system',
          content: '[project_state_snapshot]\nworkflowStage=needs_style_choice\n[/project_state_snapshot]',
        }],
        tools: [
          {
            type: 'function',
            function: { name: 'generate_edit_style_previews', parameters: { type: 'object' } },
          },
          {
            type: 'function',
            function: { name: 'request_edit_style_choice', parameters: { type: 'object' } },
          },
        ],
      },
    })

    expect(decision).toMatchObject({
      kind: 'tool_call',
      toolName: 'request_edit_style_choice',
    })
  })

  it('injects the model-stop variant only after the atomic Bible Choice reaches refreshed workflow state', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'stop-after-successful-confirmation',
      requestOrdinal: 17,
      request: {
        model: 'golden-model',
        messages: [
          {
            role: 'assistant',
            tool_calls: [{
              id: 'bible-choice-call',
              type: 'function',
              function: { name: 'request_edit_bible_review_choice', arguments: '{}' },
            }],
          },
          {
            role: 'tool',
            tool_call_id: 'bible-choice-call',
            content: '{"ok":true,"decision":"approve","aspectRatio":"16:9"}',
          },
          {
            role: 'system',
            content: '[project_state_snapshot]\nworkflowStage=ready_to_generate_style_previews\n[/project_state_snapshot]',
          },
        ],
        tools: [{
          type: 'function',
          function: { name: 'generate_edit_style_previews', parameters: { type: 'object' } },
        }],
      },
    })

    expect(decision).toMatchObject({
      kind: 'text',
      text: expect.stringContaining('confirmation was committed'),
    })
  })

  it('passes null when production asks AI to let the system resolve chapter scope', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 18,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: 'Plan every missing chapter.' }],
        tools: [{
          type: 'function',
          function: {
            name: 'plan_chapters',
            parameters: {
              type: 'object',
              required: ['chapterIds'],
              properties: {
                chapterIds: {
                  anyOf: [
                    { type: 'array', items: { type: 'string' }, minItems: 1 },
                    { type: 'null' },
                  ],
                },
              },
            },
          },
        }],
      },
    })

    expect(decision).toMatchObject({
      kind: 'tool_call',
      toolName: 'plan_chapters',
      argumentsJson: '{"chapterIds":null}',
    })
  })

  it('emits every declared workflow operation-group member in one model response', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 19,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'system',
          content: '[project_state_snapshot]\nworkflowStage=ready_to_generate_edit_script\nworkflowOperationGroupIds=generate_edit_script_assets,plan_chapters\n[/project_state_snapshot]',
        }],
        tools: [
          { type: 'function', function: { name: 'generate_edit_script_assets', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'plan_chapters', parameters: { type: 'object' } } },
        ],
      },
    })

    expect(decision).toMatchObject({
      kind: 'tool_calls',
      calls: [
        { toolName: 'generate_edit_script_assets' },
        { toolName: 'plan_chapters' },
      ],
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
