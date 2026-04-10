import { createHash } from 'crypto'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { safeParseJsonObject } from '@/lib/json-repair'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { parseProfileData } from '@/types/character-profile'
import type { Locale } from '@/i18n/routing'
import { COMFYUI_DESIGNED_VOICE_ID_PREFIX, isComfyUiDesignedVoiceId } from './comfyui-designed-voice-id'

export const COMFYUI_FISH_AUDIO_S2_VOICE_DESIGN_WORKFLOW_ID = 'baseaudio/\u97f3\u8272/s2-se'

export interface VoiceDesignCharacterAppearance {
  label?: string | null
  description?: string | null
}

export interface VoiceDesignCharacterContext {
  name: string
  aliases?: string | null
  introduction?: string | null
  profileData?: string | null
  appearances?: VoiceDesignCharacterAppearance[]
}

export interface FishAudioS2PromptInput {
  userId: string
  locale: Locale
  model: string
  projectId: string
  speakerName: string
  userVoicePrompt: string
  previewText: string
  character?: VoiceDesignCharacterContext | null
}

export interface FishAudioS2PromptResult {
  voicePrompt: string
  fishText: string
}

export interface FishAudioS2LinePromptInput {
  userId: string
  locale: Locale
  model: string
  projectId: string
  speakerName: string
  lineText: string
  emotionPrompt?: string | null
  emotionStrength?: number | null
  dialogueContext?: string | null
  sceneContext?: string | null
  character?: VoiceDesignCharacterContext | null
}

const FISH_AUDIO_STYLE_RULES: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /青年(?:男性|男声|男)/u, tag: '青年男声' },
  { pattern: /中年(?:男性|男声|男)/u, tag: '中年男声' },
  { pattern: /成熟(?:男性|男声|男)/u, tag: '成熟男声' },
  { pattern: /少年(?:男性|男声|男)/u, tag: '少年男声' },
  { pattern: /男性|男声|男播音|男旁白/u, tag: '男声' },
  { pattern: /青年(?:女性|女声|女)/u, tag: '青年女声' },
  { pattern: /中年(?:女性|女声|女)/u, tag: '中年女声' },
  { pattern: /成熟(?:女性|女声|女)/u, tag: '成熟女声' },
  { pattern: /少女|女孩|女生|女声|女性/u, tag: '女声' },
  { pattern: /低沉|低音/u, tag: '低沉' },
  { pattern: /磁性/u, tag: '磁性' },
  { pattern: /沉稳|稳重/u, tag: '沉稳' },
  { pattern: /冷静|冷冽/u, tag: '冷静' },
  { pattern: /克制|内敛/u, tag: '克制' },
  { pattern: /温和|温暖/u, tag: '温和' },
  { pattern: /轻柔|柔和/u, tag: '轻柔' },
  { pattern: /知性/u, tag: '知性' },
  { pattern: /活泼|开朗/u, tag: '活泼' },
  { pattern: /甜美/u, tag: '甜美' },
  { pattern: /旁白|叙事|叙述/u, tag: '叙事感' },
]

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseAliases(raw: string | null | undefined): string[] {
  const value = readTrimmedString(raw)
  if (!value) return []

  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => readTrimmedString(item))
        .filter(Boolean)
    }
  } catch {
    // Fall back to delimiter-based parsing.
  }

  return value
    .split(/[\uFF0C,\u3001/|]/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatAppearanceBlock(appearances?: VoiceDesignCharacterAppearance[]): string {
  if (!Array.isArray(appearances) || appearances.length === 0) {
    return '未提供稳定外形描述。'
  }

  const lines = appearances
    .map((appearance, index) => {
      const description = readTrimmedString(appearance.description)
      if (!description) return ''
      const label = readTrimmedString(appearance.label) || `Appearance ${index + 1}`
      return `- ${label}: ${description}`
    })
    .filter(Boolean)

  return lines.length > 0 ? lines.join('\n') : '未提供稳定外形描述。'
}

export function buildVoiceDesignCharacterContextSummary(character?: VoiceDesignCharacterContext | null): string {
  if (!character) return '未提供具体人物设定。'

  const lines: string[] = []
  const name = readTrimmedString(character.name)
  if (name) lines.push(`角色名: ${name}`)

  const aliases = parseAliases(character.aliases)
  if (aliases.length > 0) lines.push(`别名: ${aliases.join(' / ')}`)

  const introduction = readTrimmedString(character.introduction)
  if (introduction) lines.push(`人物简介: ${introduction}`)

  const profile = parseProfileData(character.profileData ?? null)
  if (profile) {
    lines.push(`性别: ${profile.gender}`)
    lines.push(`年龄段: ${profile.age_range}`)
    lines.push(`角色原型: ${profile.archetype}`)
    lines.push(`时代背景: ${profile.era_period}`)
    lines.push(`社会阶层: ${profile.social_class}`)
    lines.push(`角色层级: ${profile.role_level}`)
    lines.push(`服装层级: ${profile.costume_tier}`)
    if (profile.occupation?.trim()) lines.push(`职业: ${profile.occupation.trim()}`)
    if (profile.personality_tags.length > 0) lines.push(`性格标签: ${profile.personality_tags.join(' / ')}`)
    if (profile.visual_keywords.length > 0) lines.push(`视觉关键词: ${profile.visual_keywords.join(' / ')}`)
    if (profile.suggested_colors.length > 0) lines.push(`建议色彩: ${profile.suggested_colors.join(' / ')}`)
    if (profile.primary_identifier?.trim()) lines.push(`核心识别点: ${profile.primary_identifier.trim()}`)
  }

  lines.push('外形与出场描述:')
  lines.push(formatAppearanceBlock(character.appearances))

  return lines.join('\n')
}

function readPromptField(parsed: Record<string, unknown>, field: string): string {
  return readTrimmedString(parsed[field])
}

function collectFishAudioStyleTags(...sources: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const source of sources) {
    const text = readTrimmedString(source)
    if (!text) continue

    for (const rule of FISH_AUDIO_STYLE_RULES) {
      if (!rule.pattern.test(text)) continue
      if (seen.has(rule.tag)) continue
      seen.add(rule.tag)
      tags.push(rule.tag)
      if (tags.length >= 4) return tags
    }
  }

  return tags
}

function pruneOverlappingFishAudioTags(tags: string[]): string[] {
  const hasSpecificMale = tags.some((tag) => tag !== '男声' && tag.endsWith('男声'))
  const hasSpecificFemale = tags.some((tag) => tag !== '女声' && tag.endsWith('女声'))

  return tags.filter((tag) => {
    if (tag === '男声' && hasSpecificMale) return false
    if (tag === '女声' && hasSpecificFemale) return false
    return true
  })
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildFishAudioS2RenderText(input: {
  fishText: string
  voicePrompt?: string | null
  userVoicePrompt?: string | null
}): string {
  const fishText = readTrimmedString(input.fishText)
  if (!fishText) return ''

  const tags = pruneOverlappingFishAudioTags(collectFishAudioStyleTags(input.userVoicePrompt, input.voicePrompt))
  if (tags.length === 0) return fishText

  const missingTags = tags.filter((tag) => !new RegExp(`\\[${escapeRegExp(tag)}\\]`, 'u').test(fishText))
  if (missingTags.length === 0) return fishText

  const prefix = missingTags.map((tag) => `[${tag}]`).join('')
  return `${prefix} ${fishText}`
}

export function buildComfyUiDesignedVoiceId(input: {
  workflowKey?: string
  fishText: string
  preferredName?: string
}): string {
  const digest = createHash('sha1')
    .update(`${input.workflowKey || COMFYUI_FISH_AUDIO_S2_VOICE_DESIGN_WORKFLOW_ID}:${input.preferredName || ''}:${input.fishText}`)
    .digest('hex')
    .slice(0, 24)

  return `${COMFYUI_DESIGNED_VOICE_ID_PREFIX}${digest}`
}

export { isComfyUiDesignedVoiceId }

export async function generateFishAudioS2Prompt(input: FishAudioS2PromptInput): Promise<FishAudioS2PromptResult> {
  const characterContext = buildVoiceDesignCharacterContextSummary(input.character)
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.FISH_AUDIO_S2_VOICE_DESIGN,
    locale: input.locale,
    variables: {
      speaker_name: input.speakerName,
      character_context: characterContext,
      user_voice_prompt: input.userVoicePrompt,
      preview_text: input.previewText,
    },
  })

  const completion = await executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    projectId: input.projectId,
    action: 'fish_audio_s2_voice_design_prompt',
    meta: {
      stepId: 'fish_audio_s2_voice_design_prompt',
      stepTitle: 'Fish Audio S2 voice prompt',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  const parsed = safeParseJsonObject(completion.text)
  const fishText = readPromptField(parsed, 'fish_text')
  const voicePrompt = readPromptField(parsed, 'voice_prompt')

  if (!fishText) {
    throw new Error('VOICE_DESIGN_PROMPT_INVALID: missing fish_text')
  }

  return {
    voicePrompt: voicePrompt || input.userVoicePrompt.trim(),
    fishText,
  }
}

export async function generateFishAudioS2LinePrompt(input: FishAudioS2LinePromptInput): Promise<FishAudioS2PromptResult> {
  const characterContext = buildVoiceDesignCharacterContextSummary(input.character)
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.FISH_AUDIO_S2_LINE_RENDER,
    locale: input.locale,
    variables: {
      speaker_name: input.speakerName,
      character_context: characterContext,
      line_text: input.lineText.trim(),
      emotion_prompt: readTrimmedString(input.emotionPrompt) || '未提供额外情绪备注。',
      emotion_strength:
        typeof input.emotionStrength === 'number' && Number.isFinite(input.emotionStrength)
          ? input.emotionStrength.toFixed(2)
          : '0.20',
      dialogue_context: readTrimmedString(input.dialogueContext) || '未提供额外对白上下文。',
      scene_context: readTrimmedString(input.sceneContext) || '未提供明确分镜上下文。',
    },
  })

  const completion = await executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    projectId: input.projectId,
    action: 'fish_audio_s2_line_prompt',
    meta: {
      stepId: 'fish_audio_s2_line_prompt',
      stepTitle: 'Fish Audio S2 line prompt',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  const parsed = safeParseJsonObject(completion.text)
  const fishText = readPromptField(parsed, 'fish_text')
  const voicePrompt = readPromptField(parsed, 'voice_prompt')

  if (!fishText) {
    throw new Error('VOICE_LINE_PROMPT_INVALID: missing fish_text')
  }

  return {
    voicePrompt: voicePrompt || readTrimmedString(input.emotionPrompt),
    fishText,
  }
}
