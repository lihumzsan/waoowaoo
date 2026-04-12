import type { Locale } from '@/i18n/routing'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { getModelsByType, getProviderKey } from '@/lib/api-config'
import { composeModelKey, getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { safeParseJsonObject } from '@/lib/json-repair'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { prisma } from '@/lib/prisma'
import { parseProfileData } from '@/types/character-profile'

const PREFERRED_BAILIAN_TEXT_MODEL_IDS = [
  'qwen3.5-plus',
  'qwen3.5-flash',
  'qwen-plus',
  'qwen-turbo',
] as const

export interface Ltx23PromptEnhancementVoiceLine {
  id: string
  speaker: string
  content: string
  audioDuration?: number | null
}

export interface Ltx23PromptEnhancementPanel {
  panelIndex?: number | null
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  location?: string | null
  characters?: string | null
  props?: string | null
  srtSegment?: string | null
  sceneType?: string | null
  clipContent?: string | null
}

export interface EnhanceLtx23VideoPromptInput {
  userId: string
  locale: Locale
  projectId: string
  modelKey: string
  originalPrompt: string
  panel: Ltx23PromptEnhancementPanel
  linkedVoiceLines?: Ltx23PromptEnhancementVoiceLine[] | null
  durationSeconds?: number | null
  fps?: number | null
  generationMode?: 'normal' | 'firstlastframe'
  artStyle?: string | null
  userEdited?: boolean
}

export interface Ltx23PromptEnhancementResult {
  prompt: string
  enhanced: boolean
  textModel: string | null
}

type CharacterContextRow = {
  name: string
  aliases?: string | null
  introduction?: string | null
  profileData?: string | null
  appearances: Array<{
    changeReason?: string | null
    description?: string | null
  }>
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function truncateText(value: unknown, maxLength: number): string {
  const text = readTrimmedString(value).replace(/\s+/g, ' ')
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`
}

function parseNameList(raw: string | null | undefined): string[] {
  const text = readTrimmedString(raw)
  if (!text) return []

  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) {
      const seen = new Set<string>()
      return parsed
        .map((item) => readTrimmedString(item))
        .filter((item) => {
          if (!item || seen.has(item)) return false
          seen.add(item)
          return true
        })
    }
  } catch {
    // Fall back to delimiter-based parsing.
  }

  const seen = new Set<string>()
  return text
    .split(/[\n,，、/|]/u)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

export function isLtx23VideoModel(modelKey: string | null | undefined): boolean {
  const normalized = readTrimmedString(modelKey).toLowerCase()
  return normalized.includes('ltx2.3')
    || normalized.includes('ltx-2.3')
    || normalized.includes('/ltx')
    || normalized.includes('ltxv')
}

async function resolveLtx23PromptTextModel(userId: string, projectId: string): Promise<string | null> {
  const projectConfig = await getProjectModelConfig(projectId, userId)
  if (projectConfig.analysisModel && getProviderKey(projectConfig.analysisModel) === 'bailian') {
    return projectConfig.analysisModel
  }

  const userConfig = await getUserModelConfig(userId)
  if (userConfig.analysisModel && getProviderKey(userConfig.analysisModel) === 'bailian') {
    return userConfig.analysisModel
  }

  const llmModels = await getModelsByType(userId, 'llm')
  const bailianModels = llmModels.filter((model) => getProviderKey(model.provider) === 'bailian')

  for (const modelId of PREFERRED_BAILIAN_TEXT_MODEL_IDS) {
    const matched = bailianModels.find((model) => model.modelId === modelId)
    if (matched) {
      return composeModelKey(matched.provider, matched.modelId)
    }
  }

  if (bailianModels[0]) {
    return composeModelKey(bailianModels[0].provider, bailianModels[0].modelId)
  }

  return projectConfig.analysisModel || userConfig.analysisModel || null
}

async function loadCharacterContextRows(
  projectId: string,
  rawCharacters: string | null | undefined,
): Promise<CharacterContextRow[]> {
  const names = parseNameList(rawCharacters)
  if (names.length === 0) return []

  return await prisma.novelPromotionCharacter.findMany({
    where: {
      novelPromotionProjectId: projectId,
      name: { in: names },
    },
    select: {
      name: true,
      aliases: true,
      introduction: true,
      profileData: true,
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
        select: {
          changeReason: true,
          description: true,
        },
        take: 2,
      },
    },
  })
}

function buildCharacterContextText(characters: CharacterContextRow[]): string {
  if (characters.length === 0) {
    return 'No structured character profile was found for this panel.'
  }

  return characters
    .map((character) => {
      const lines: string[] = [`Name: ${character.name}`]
      const aliases = readTrimmedString(character.aliases)
      if (aliases) lines.push(`Aliases: ${truncateText(aliases, 80)}`)
      const introduction = truncateText(character.introduction, 140)
      if (introduction) lines.push(`Introduction: ${introduction}`)

      const profile = parseProfileData(character.profileData ?? null)
      if (profile) {
        const profileTags = [
          profile.gender && `gender=${profile.gender}`,
          profile.age_range && `age=${profile.age_range}`,
          profile.archetype && `archetype=${profile.archetype}`,
          profile.occupation && `occupation=${profile.occupation}`,
          profile.personality_tags.length > 0 && `personality=${profile.personality_tags.slice(0, 4).join('/')}`,
          profile.visual_keywords.length > 0 && `visual=${profile.visual_keywords.slice(0, 4).join('/')}`,
        ].filter(Boolean)
        if (profileTags.length > 0) lines.push(`Profile: ${profileTags.join('; ')}`)
      }

      if (character.appearances.length > 0) {
        const appearanceText = character.appearances
          .map((appearance) => {
            const description = truncateText(appearance.description, 120)
            if (!description) return ''
            const label = readTrimmedString(appearance.changeReason) || 'default'
            return `${label}: ${description}`
          })
          .filter(Boolean)
          .join(' | ')
        if (appearanceText) lines.push(`Appearance: ${appearanceText}`)
      }

      return lines.join('\n')
    })
    .join('\n\n')
}

function buildPanelContextText(input: EnhanceLtx23VideoPromptInput): string {
  const panel = input.panel
  const lines = [
    typeof panel.panelIndex === 'number' ? `Panel index: ${panel.panelIndex + 1}` : '',
    truncateText(panel.description, 180) && `Panel description: ${truncateText(panel.description, 180)}`,
    truncateText(panel.location, 100) && `Location: ${truncateText(panel.location, 100)}`,
    truncateText(panel.characters, 100) && `Characters on screen: ${truncateText(panel.characters, 100)}`,
    truncateText(panel.props, 100) && `Props: ${truncateText(panel.props, 100)}`,
    truncateText(panel.shotType, 80) && `Shot type: ${truncateText(panel.shotType, 80)}`,
    truncateText(panel.cameraMove, 80) && `Camera move: ${truncateText(panel.cameraMove, 80)}`,
    truncateText(panel.sceneType, 80) && `Scene type: ${truncateText(panel.sceneType, 80)}`,
    truncateText(panel.srtSegment, 120) && `Subtitle/dialogue in panel: ${truncateText(panel.srtSegment, 120)}`,
    truncateText(panel.clipContent, 220) && `Clip context: ${truncateText(panel.clipContent, 220)}`,
    truncateText(input.artStyle, 80) && `Project visual style: ${truncateText(input.artStyle, 80)}`,
  ].filter(Boolean)

  return lines.length > 0 ? lines.join('\n') : 'No extra panel metadata was provided.'
}

function normalizeDialogueText(value: unknown): string {
  return readTrimmedString(value).replace(/\s+/g, ' ')
}

function buildStrictDialogueContextText(
  locale: Locale,
  voiceLines: Ltx23PromptEnhancementVoiceLine[] | null | undefined,
): string {
  if (!Array.isArray(voiceLines) || voiceLines.length === 0) return ''

  type NormalizedDialogueLine = {
    speaker: string
    content: string
  }

  const normalizedLines = voiceLines
    .slice(0, 4)
    .map((line, index) => {
      const speaker = readTrimmedString(line.speaker) || `Speaker ${index + 1}`
      const content = normalizeDialogueText(line.content)
      if (!content) return ''
      return { speaker, content }
    })
    .filter((line): line is NormalizedDialogueLine => !!line)

  if (normalizedLines.length === 0) return ''

  if (locale === 'zh') {
    const exactLines = normalizedLines
      .map(({ speaker, content }, index) => `${index + 1}. ${speaker}必须逐字说出：“${content}”`)
      .join('\n')
    return [
      '严格台词约束：',
      '1. 下面列出的台词必须逐字保留到最终视频提示词里，不能改写、不能同义替换、不能翻译、不能总结。',
      '2. 如果镜头中人物在说话，必须明确写出对应的原句，并让口型、停顿、节奏贴合这句台词。',
      '3. 不要用“正在说话”“像是在提问”这类泛化描述替换原句。',
      exactLines,
    ].join('\n')
  }

  const exactLines = normalizedLines
    .map(({ speaker, content }, index) => `${index + 1}. ${speaker} must say exactly: "${content}"`)
    .join('\n')
  return [
    'Strict dialogue preservation rules:',
    '1. The exact spoken lines below must be preserved verbatim in the final video prompt.',
    '2. Do not paraphrase, summarize, translate, or replace the dialogue with generic speaking descriptions.',
    '3. If the character is speaking on screen, include the exact quoted line and align mouth motion, pauses, and timing to it.',
    exactLines,
  ].join('\n')
}

function buildAudioContextText(
  locale: Locale,
  voiceLines: Ltx23PromptEnhancementVoiceLine[] | null | undefined,
  durationSeconds?: number | null,
): string {
  const safeDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : null

  if (!Array.isArray(voiceLines) || voiceLines.length === 0) {
    return safeDuration
      ? `No linked audio clips were selected. Target video duration is ${safeDuration.toFixed(2)} seconds.`
      : 'No linked audio clips were selected.'
  }

  const lineSummary = voiceLines
    .slice(0, 4)
    .map((line, index) => {
      const parts = [
        `${index + 1}. ${readTrimmedString(line.speaker) || 'Unknown speaker'}`,
        truncateText(line.content, 120),
      ].filter(Boolean)
      const durationText = typeof line.audioDuration === 'number' && Number.isFinite(line.audioDuration) && line.audioDuration > 0
        ? ` (${(line.audioDuration / 1000).toFixed(2)}s)`
        : ''
      return `${parts.join(': ')}${durationText}`
    })
    .join('\n')

  const header = safeDuration
    ? `Linked audio count: ${voiceLines.length}\nTarget video duration from linked audio: ${safeDuration.toFixed(2)} seconds.`
    : `Linked audio count: ${voiceLines.length}`

  const strictDialogueContext = buildStrictDialogueContextText(locale, voiceLines)
  return strictDialogueContext
    ? `${header}\nVoice lines:\n${lineSummary}\n\n${strictDialogueContext}`
    : `${header}\nVoice lines:\n${lineSummary}`
}

function buildGenerationContextText(input: EnhanceLtx23VideoPromptInput): string {
  const lines = [
    'Target model: ComfyUI LTX2.3 image-to-video.',
    'This is a short single-shot video. Avoid scene cuts, jump cuts, time skips, and multi-part action beats.',
    input.generationMode === 'firstlastframe'
      ? 'Generation mode: first-to-last-frame continuity. Motion should bridge naturally from the starting frame to the ending frame.'
      : 'Generation mode: normal single-shot image-to-video.',
    typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? `Target duration: ${input.durationSeconds.toFixed(2)} seconds.`
      : 'Target duration: keep the action concise and stable.',
    typeof input.fps === 'number' && Number.isFinite(input.fps) && input.fps > 0
      ? `Frame rate: ${Math.round(input.fps)} fps.`
      : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function readEnhancedPromptField(parsed: Record<string, unknown>): string {
  return readTrimmedString(parsed.enhanced_prompt)
}

function buildVerbatimDialogueConstraint(
  locale: Locale,
  voiceLines: Ltx23PromptEnhancementVoiceLine[] | null | undefined,
): string {
  if (!Array.isArray(voiceLines) || voiceLines.length === 0) return ''

  const normalizedLines = voiceLines
    .slice(0, 4)
    .map((line) => normalizeDialogueText(line.content))
    .filter(Boolean)

  if (normalizedLines.length === 0) return ''

  if (locale === 'zh') {
    if (normalizedLines.length === 1) {
      return `对白必须严格说出“${normalizedLines[0]}”，口型、停顿与节奏贴合这句台词，不得改写、翻译或替换。`
    }
    const orderedLines = normalizedLines
      .map((line, index) => `${index + 1}. “${line}”`)
      .join(' ')
    return `对白必须严格按顺序说出以下台词：${orderedLines} 口型、停顿与节奏贴合对应句子，不得改写、合并、翻译或替换。`
  }

  if (normalizedLines.length === 1) {
    return `The spoken dialogue must match exactly "${normalizedLines[0]}". Match mouth movement, pauses, and timing to this exact line. Do not paraphrase, translate, or replace it.`
  }
  const orderedLines = normalizedLines
    .map((line, index) => `${index + 1}. "${line}"`)
    .join(' ')
  return `The spoken dialogue must follow these exact lines in order: ${orderedLines} Match mouth movement, pauses, and timing to each line. Do not paraphrase, merge, translate, or replace them.`
}

function appendDialogueConstraint(basePrompt: string, constraint: string, locale: Locale): string {
  const trimmedBase = readTrimmedString(basePrompt)
  const trimmedConstraint = readTrimmedString(constraint)

  if (!trimmedConstraint) return trimmedBase
  if (!trimmedBase) return trimmedConstraint

  const separator = /[。！？.!?]$/.test(trimmedBase)
    ? ' '
    : (locale === 'zh' ? '。' : '. ')
  return `${trimmedBase}${separator}${trimmedConstraint}`
}

export async function enhanceLtx23VideoPrompt(
  input: EnhanceLtx23VideoPromptInput,
): Promise<Ltx23PromptEnhancementResult> {
  const originalPrompt = readTrimmedString(input.originalPrompt)
  if (!originalPrompt) {
    return {
      prompt: '',
      enhanced: false,
      textModel: null,
    }
  }

  if (!isLtx23VideoModel(input.modelKey)) {
    return {
      prompt: originalPrompt,
      enhanced: false,
      textModel: null,
    }
  }

  if (input.userEdited) {
    return {
      prompt: originalPrompt,
      enhanced: false,
      textModel: null,
    }
  }

  const textModel = await resolveLtx23PromptTextModel(input.userId, input.projectId)
  if (!textModel) {
    return {
      prompt: originalPrompt,
      enhanced: false,
      textModel: null,
    }
  }

  try {
    const characters = await loadCharacterContextRows(input.projectId, input.panel.characters)
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.LTX23_VIDEO_PROMPT_ENHANCE,
      locale: input.locale,
      variables: {
        original_prompt: originalPrompt,
        panel_context: buildPanelContextText(input),
        character_context: buildCharacterContextText(characters),
        audio_context: buildAudioContextText(input.locale, input.linkedVoiceLines, input.durationSeconds),
        generation_context: buildGenerationContextText(input),
      },
    })

    const completion = await executeAiTextStep({
      userId: input.userId,
      model: textModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      projectId: input.projectId,
      action: 'ltx23_video_prompt_enhance',
      meta: {
        stepId: 'ltx23_video_prompt_enhance',
        stepTitle: 'LTX2.3 prompt enhance',
        stepIndex: 1,
        stepTotal: 1,
      },
    })

    const parsed = safeParseJsonObject(completion.text)
    const enhancedPrompt = readEnhancedPromptField(parsed)
    const dialogueConstraint = buildVerbatimDialogueConstraint(input.locale, input.linkedVoiceLines)
    if (!enhancedPrompt) {
      return {
        prompt: appendDialogueConstraint(originalPrompt, dialogueConstraint, input.locale),
        enhanced: false,
        textModel,
      }
    }

    const finalPrompt = appendDialogueConstraint(enhancedPrompt, dialogueConstraint, input.locale)

    return {
      prompt: finalPrompt,
      enhanced: finalPrompt !== originalPrompt,
      textModel,
    }
  } catch {
    const dialogueConstraint = buildVerbatimDialogueConstraint(input.locale, input.linkedVoiceLines)
    return {
      prompt: appendDialogueConstraint(originalPrompt, dialogueConstraint, input.locale),
      enhanced: false,
      textModel,
    }
  }
}
