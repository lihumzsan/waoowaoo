import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoldenModelServer } from '../providers/model/server'
import { startGoldenModelServer } from '../providers/model/server'
import {
  decideGoldenModelResponse,
  GOLDEN_FREEFORM_IMAGE_REQUEST,
  GOLDEN_FREEFORM_RETRY_REQUEST,
  GOLDEN_FREEFORM_VIDEO_REQUEST,
  GOLDEN_REMAINING_VIDEO_REQUEST,
} from '../providers/model/policy'
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
import {
  expandedSourceScriptOutputSchema,
  normalizeExpandedSourceScriptOutput,
} from '@/lib/edit-bible'
import { validateEditBibleBundle } from '@/lib/edit-bible/cross-check'
import { buildEditSourceBlocks, formatEditSourceBlocksForPrompt } from '@/lib/edit-source-document'
import { editStylePreviewOptionsSchema } from '@/lib/edit-script/types'
import { editScriptCoreSchema } from '@/lib/edit-script/types'
import { normalizeEditShotExecutionPlan } from '@/lib/edit-script/normalize'
import { buildShotExecutionPlanPromptStructure } from '@/lib/edit-script/shot-execution-plan-prompt'
import { normalizeChapterPlanOutput } from '@/lib/edit-chapter'
import { parseLocationCandidatePrompt } from '@/lib/asset-generation/location-candidate-prompts'
import { buildBgmDesignPlanPrompt } from '@/lib/bgm-design/prompt'
import { bgmDesignSchema } from '@/lib/bgm-design/types'
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
    const parsed = expandedSourceScriptOutputSchema.parse(JSON.parse(decision.text) as unknown)
    expect(parsed.segments).toHaveLength(2)
    expect(normalizeExpandedSourceScriptOutput(parsed).structure.episodes[0]?.acts).toHaveLength(2)
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
          content: '{"stylePreviews":[{"visualStyle":"string","assetImageStyle":{"lighting":"string","texture":"string","composition":"string"},"gridImagePrompt":"string"}]}',
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
          dialogue: [],
          synchronousSound: '一次短促石块碰撞声。',
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
            performance: '谨慎靠近',
          }],
          dialogue: [],
          synchronousSound: '一次脚步声。',
        },
      ],
      generationSegments: [{
        segmentId: 'segment-real-1',
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
          content: `核心剪辑计划：\n${JSON.stringify(productionPromptInput)}\n\n只输出包含 "generationSegments" 和 "cameraMovement" 的 JSON。`,
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
    expect(normalized.generationSegments[0]?.shots.map((shot) => shot.shotId)).toEqual(['shot-real-1', 'shot-real-2'])
    expect(normalized.generationSegments[0]?.shots.every((shot) => shot.cameraMovement.stability === 'smooth')).toBe(true)
  })

  it('honors the one production BgmDesign contract without media-analysis input', () => {
    const prompt = buildBgmDesignPlanPrompt({
      locale: 'zh',
      planningInput: {
        clock: { fps: 24, sampleRate: 48_000, totalFrames: 288 },
        clips: [{
          sourceId: 'chapter-1',
          order: 1,
          range: { startFrame: 0, endFrameExclusive: 288 },
          shotIds: ['shot-1'],
          shotNumbers: [1],
          description: '暮色中的废弃祭坛。',
          synchronousSound: '风声。',
        }],
        scriptShots: [{
          chapterId: 'chapter-1',
          shotId: 'shot-1',
          shotNumber: 1,
          range: { startFrame: 0, endFrameExclusive: 288 },
          scene: { locationId: 'location-1', name: '废弃祭坛', subScene: '祭坛前' },
          shotPurpose: 'establishing',
          action: '旅人停在祭坛前。',
          dialogue: [],
          synchronousSound: '风声。',
        }],
      },
    })
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 23,
      request: {
        model: 'golden-model',
        messages: [{ role: 'user', content: prompt }],
      },
    })

    expect(decision.kind).toBe('text')
    if (decision.kind !== 'text') return
    const design = bgmDesignSchema.parse(JSON.parse(decision.text))
    expect(design.scorePresence).toHaveLength(1)
    expect(design.scoreCue.range).toEqual({ startFrame: 0, endFrameExclusive: 288 })
    expect(prompt).toContain('use ONLY the locked edit-script facts and rendered clip identity/duration metadata')
    expect(prompt).toContain('Do not inspect, infer from, request, or claim analysis of video frames, native audio waveforms, final video, or final mix.')
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
        authorization: 'Bearer golden-scenario:normal-mainline',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'golden-model',
        messages: [{
          role: 'user',
          content: '只输出包含 "questions" 和 targetRuntime 的 JSON。',
        }],
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

  it('uses the advisory mainline position to raise the user Choice after asynchronous style tasks finish', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 16,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'system',
          content: '[project_state_snapshot]\nmainlineStep=visual_style\nmainlineStatus=needs_user_choice\nmainlineStatusReason=choose and confirm one completed style preview\nmainlineRecommendedOperation=none\n[/project_state_snapshot]',
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

  it('pauses the mainline for one Canvas video before submitting the remaining batch', () => {
    const request = (userText: string) => ({
      model: 'golden-model',
      messages: [
        {
          role: 'system' as const,
          content: '[project_state_snapshot]\nmainlineStep=video_segments\nmainlineStatus=ready\nmainlineRecommendedOperation=render_chapters\n[/project_state_snapshot]',
        },
        { role: 'user' as const, content: userText },
      ],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'generate_video_segments',
            parameters: {
              type: 'object',
              required: ['scope'],
              properties: {
                scope: {
                  type: 'object',
                  required: ['kind', 'chapterId'],
                  properties: {
                    kind: { type: 'string', enum: ['pending'] },
                    chapterId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  },
                },
              },
            },
          },
        },
        {
          type: 'function' as const,
          function: { name: 'render_chapters', parameters: { type: 'object' } },
        },
      ],
    })

    expect(decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 19,
      request: request('wait for the Canvas action'),
    })).toMatchObject({ kind: 'text' })
    expect(decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 20,
      request: request(GOLDEN_REMAINING_VIDEO_REQUEST),
    })).toMatchObject({
      kind: 'tool_call',
      toolName: 'generate_video_segments',
      argumentsJson: JSON.stringify({ scope: { kind: 'pending', chapterId: null } }),
    })
  })

  it('emits one recommended Operation per model response even when several tools are available', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 19,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'system',
          content: '[project_state_snapshot]\nmainlineStep=chapter_plan\nmainlineStatus=ready\nmainlineRecommendedOperation=generate_edit_script_assets\n[/project_state_snapshot]',
        }],
        tools: [
          { type: 'function', function: { name: 'generate_edit_script_assets', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'plan_chapters', parameters: { type: 'object' } } },
        ],
      },
    })

    expect(decision).toMatchObject({
      kind: 'tool_call',
      toolName: 'generate_edit_script_assets',
    })
  })

  it('stops after the durable final render instead of reopening script intake', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 20,
      request: {
        model: 'golden-model',
        messages: [{
          role: 'system',
          content: '[project_state_snapshot]\nmainlineStep=final_render\nmainlineStatus=completed\nmainlineRecommendedOperation=none\n[/project_state_snapshot]',
        }],
        tools: [{
          type: 'function',
          function: { name: 'request_script_intake_choice', parameters: { type: 'object' } },
        }],
      },
    })

    expect(decision).toMatchObject({ kind: 'text' })
  })

  it('routes a freeform image request directly to create_image without consulting the mainline', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 21,
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
        prompt: 'A cinematic midnight shrine in mist, wide composition.',
        request: { kind: 'new', count: 3 },
      }),
    })
  })

  it('reports a freeform Task continuation without repeating the original tool', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 22,
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
      scenarioId: 'normal-mainline',
      requestOrdinal: 23,
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
        prompt: 'A cinematic midnight shrine in mist, wide composition.',
        request: { kind: 'retry', resourceIds: ['failed-resource-1'] },
      }),
    })
  })

  it('passes exact listed image revisions into freeform video generation', () => {
    const decision = decideGoldenModelResponse({
      scenarioId: 'normal-mainline',
      requestOrdinal: 24,
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
      request: { kind: 'new', count: 2 },
      references: [{
        resourceId: 'image-resource-1',
        revisionId: 'image-revision-1',
        fingerprint: 'f'.repeat(64),
      }],
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
