import type { Locale } from '@/i18n/routing'
import type { FinalRenderClipPlan, FinalRenderProjectContextInput } from '@/lib/video-compose/final-render-plan'

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function buildProjectContextPayload(projectContext: FinalRenderProjectContextInput | null | undefined): unknown {
  if (!projectContext) return {}
  return {
    videoRatio: normalizeString(projectContext.videoRatio) || null,
  }
}

function buildTimelinePayload(clips: readonly FinalRenderClipPlan[]): unknown {
  return clips.map((clip) => ({
    clipOrder: clip.order,
    sourceKind: clip.sourceKind,
    shotNumbers: clip.shotNumbers,
    durationSeconds: clip.durationSeconds,
    visualSummary: clip.description,
    nativeVideoSoundDirection: clip.sound,
  }))
}

const shapeExample = {
  decision: 'soundscape',
  sources: [
    {
      sourceId: 'source-001',
      environmentFingerprint: 'night_city_rooftop_wind',
      prompt: 'Seamless loop of steady rooftop wind with distant city hum, no music, no voices, no footsteps.',
      loopDurationSeconds: 30,
      promptInfluence: 0.55,
    },
  ],
  sections: [
    {
      sourceId: 'source-001',
      fromClipOrder: 1,
      toClipOrder: 3,
      perspective: 'exterior_near',
      intensity: 'medium',
      transitionIn: 'fade',
      transitionOut: 'crossfade',
    },
  ],
}

export function buildSoundscapePlanPrompt(input: {
  readonly projectContext?: FinalRenderProjectContextInput | null
  readonly clips: readonly FinalRenderClipPlan[]
  readonly totalDurationSeconds: number
  readonly locale?: Locale
}): string {
  if (input.locale === 'zh') {
    return [
      '你是专业影视声音设计师，只为 AI 生成视频规划连续环境音 Soundscape bed。',
      '视频模型已经负责对白、动作同期声、脚步、打斗、开门、碰撞等和画面同步的短声音。',
      '你的任务只规划可无缝循环的连续环境底噪，例如风、雨、城市底噪、机械低鸣、室内空调/电流、人群远景底噪。',
      '',
      '硬规则：',
      '1. 只返回严格 JSON。不要 markdown、注释或 JSON 外文字。',
      '2. 不要输出 startSec、endSec、毫秒、ffmpeg 参数、滤镜参数、gain 数字、lowpass 数字或自由处理指令。',
      '3. sections 只能用 fromClipOrder/toClipOrder 锚定输入时间线中的 clipOrder 区间。系统会解析为内部镜头身份并推导绝对时间。',
      '4. perspective 只能是 exterior_near / exterior_far / interior / interior_behind_window。',
      '5. intensity 只能是 low / medium / high。',
      '6. transitionIn/transitionOut 只能是 cut / fade / crossfade。',
      '7. source prompt 必须要求 seamless loop，并明确 no music, no voices, no dialogue, no footsteps, no impacts。',
      '8. 如果整集不需要连续环境声，返回 decision="none_needed"，且 sources 与 sections 都为空数组。',
      '9. source prompt 必须使用简洁英文音效生成提示词；sourceId、environmentFingerprint 和枚举值必须保持英文机器可读。',
      '',
      'Required JSON shape:',
      safeJson(shapeExample),
      '',
      'Project visual/director context JSON:',
      safeJson(buildProjectContextPayload(input.projectContext)),
      '',
      'Final rendered media timeline JSON:',
      safeJson(buildTimelinePayload(input.clips)),
      '',
      `Total duration seconds: ${input.totalDurationSeconds.toFixed(3)}`,
    ].join('\n')
  }

  return [
    'You are a professional film sound designer planning only the continuous environmental Soundscape bed for an AI-generated video.',
    'The video model already handles dialogue, synchronous action sounds, footsteps, hits, doors, props, and short sounds tied to the image.',
    'Your task is only to plan seamless-loop continuous ambience such as wind, rain, city bed, machinery hum, room tone, air conditioning, electrical hum, or distant crowd beds.',
    '',
    'Hard rules:',
    '1. Return strict JSON only. No markdown, comments, or prose outside JSON.',
    '2. Do not output startSec, endSec, milliseconds, ffmpeg parameters, filter parameters, gain numbers, lowpass numbers, or free-form audio processing instructions.',
    '3. sections must anchor only by fromClipOrder/toClipOrder from the input timeline. The system resolves internal shot identities and derives absolute time.',
    '4. perspective must be one of exterior_near / exterior_far / interior / interior_behind_window.',
    '5. intensity must be one of low / medium / high.',
    '6. transitionIn/transitionOut must be one of cut / fade / crossfade.',
    '7. Every source prompt must request a seamless loop and explicitly say no music, no voices, no dialogue, no footsteps, no impacts.',
    '8. If the episode does not need a continuous environment bed, return decision="none_needed" with empty sources and sections.',
    '',
    'Required JSON shape:',
    safeJson(shapeExample),
    '',
    'Project visual/director context JSON:',
    safeJson(buildProjectContextPayload(input.projectContext)),
    '',
    'Final rendered media timeline JSON:',
    safeJson(buildTimelinePayload(input.clips)),
    '',
    `Total duration seconds: ${input.totalDurationSeconds.toFixed(3)}`,
  ].join('\n')
}
