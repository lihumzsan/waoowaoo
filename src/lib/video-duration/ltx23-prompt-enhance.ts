import type { Locale } from '@/i18n/routing'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { getProviderKey } from '@/lib/api-config'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { safeParseJsonObject } from '@/lib/json-repair'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { prisma } from '@/lib/prisma'
import type { PanelContinuityPacket } from '@/lib/novel-promotion/panel-continuity'
import {
  getLtx23WorkflowProfile,
  isComfyUiLtx23KjPromptRelayWorkflow,
  normalizeLtx23KjMotionStrength,
  resolveLtx23KjMotionStrengthLabel,
  type Ltx23PromptPolicy,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import type { ResolvedAudioDrivenVideoTiming } from '@/lib/video-duration/audio-binding'
import { parseProfileData } from '@/types/character-profile'
import { splitPromptRelayLocalSegments } from '@/lib/providers/comfyui/workflow-registry'
import { CODEX_DEFAULT_MODEL_KEY } from '@/lib/providers/codex/constants'
import { sanitizeLtx23KjNoSubtitlesPrompt } from '@/lib/video-duration/ltx23-kj-no-subtitles'

export interface Ltx23PromptEnhancementVoiceLine {
  id: string
  speaker: string
  content: string
  audioDuration?: number | null
  audioUrl?: string | null
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
  motionStrength?: number | null
  audioTiming?: ResolvedAudioDrivenVideoTiming | null
  generationMode?: 'normal' | 'firstlastframe'
  artStyle?: string | null
  userEdited?: boolean
  continuity?: PanelContinuityPacket | null
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
        .map((item) => {
          if (typeof item === 'string') return readTrimmedString(item)
          if (!item || typeof item !== 'object') return ''
          return readTrimmedString((item as Record<string, unknown>).name)
        })
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

function resolveLtx23PromptPolicy(modelKey: string | null | undefined): Ltx23PromptPolicy {
  return getLtx23WorkflowProfile(modelKey)?.promptPolicy ?? 'stable_single_image'
}

function allowsCameraMovement(policy: Ltx23PromptPolicy): boolean {
  return policy === 'large_motion_single_image' || policy === 'long_promptrelay' || policy === 'first_last_frame'
}

const ENGLISH_CAMERA_MOTION_PATTERN = /\b(?:camera\s+)?(?:push(?:es|ing)?\s*in|push-in|pull(?:s|ing)?\s*(?:back|out)|pan(?:s|ning)?|track(?:s|ing)?|doll(?:y|ies|ying)|zoom(?:s|ing)?|orbit(?:s|ing)?|circl(?:e|es|ing)|spin(?:s|ning)?|rotat(?:e|es|ing|ion)|travel(?:s|ing|ling)?)\b/i
const ENGLISH_ORBIT_CAMERA_PATTERN = /\b(?:camera\s+)?(?:orbit(?:s|ing)?|circl(?:e|es|ing)|spin(?:s|ning)?|rotat(?:e|es|ing|ion)|360(?:[-\s]?degree)?)\b/i
const CHINESE_CAMERA_MOTION_PATTERN = /(?:\u955c\u5934|\u6444\u5f71\u673a|\u76f8\u673a)?[^。！？；，,.!?]{0,16}(?:\u63a8\u8fd1|\u63a8\u5165|\u62c9\u8fdc|\u62c9\u5f00|\u5e73\u79fb|\u8ddf\u968f|\u8ddf\u62cd|\u73af\u7ed5|\u56f4\u7ed5|\u7ed5\u7740|\u7ed5\u884c|\u7ed5\u5708|\u8f6c\u5708|\u65cb\u8f6c)/u
const CHINESE_ORBIT_CAMERA_PATTERN = /(?:\u955c\u5934|\u6444\u5f71\u673a|\u76f8\u673a)?[^。！？；，,.!?]{0,16}(?:\u73af\u7ed5|\u56f4\u7ed5|\u7ed5\u7740|\u7ed5\u884c|\u7ed5\u5708|\u8f6c\u5708|\u65cb\u8f6c)/u
const CAMERA_NEGATION_PATTERN = /\b(?:do\s+not|don't|must\s+not|cannot|can't|without|no|avoid|never)\b|\u4e0d\u8981|\u4e0d\u5f97|\u4e0d\u80fd|\u7981\u6b62|\u907f\u514d/iu

function stripNegatedCameraMotionClauses(value: string): string {
  const text = readTrimmedString(value)
  if (!text) return ''
  return text
    .split(/(?<=[.!?。！？])\s+|\n/u)
    .filter((clause) => {
      const hasCameraMotion = ENGLISH_CAMERA_MOTION_PATTERN.test(clause) || CHINESE_CAMERA_MOTION_PATTERN.test(clause)
      return !(hasCameraMotion && CAMERA_NEGATION_PATTERN.test(clause))
    })
    .join('\n')
}

function hasExplicitCameraMovementIntent(value: string | null | undefined): boolean {
  const text = stripNegatedCameraMotionClauses(value ?? '')
  if (!text) return false
  return ENGLISH_CAMERA_MOTION_PATTERN.test(text) || CHINESE_CAMERA_MOTION_PATTERN.test(text)
}

function hasExplicitOrbitCameraMotionIntent(value: string | null | undefined): boolean {
  const text = stripNegatedCameraMotionClauses(value ?? '')
  if (!text) return false
  return ENGLISH_ORBIT_CAMERA_PATTERN.test(text) || CHINESE_ORBIT_CAMERA_PATTERN.test(text)
}

function addsUnrequestedOrbitCameraMotion(originalPrompt: string, candidatePrompt: string): boolean {
  return hasExplicitOrbitCameraMotionIntent(candidatePrompt) && !hasExplicitOrbitCameraMotionIntent(originalPrompt)
}

function buildCameraPolicyLines(policy: Ltx23PromptPolicy, originalPrompt: string): string[] {
  switch (policy) {
    case 'large_motion_single_image':
      return [
        `Workflow profile: ${policy}.`,
        'VBVR / PromptRelay structured format is required for enhanced_prompt.',
        'Use exactly this section shape: GLOBAL: one stable source-frame anchor; LOCAL 1: preparation; LOCAL 2: continuous progression; LOCAL 3: strongest continuous motion beat; LOCAL 4: settling motion state.',
        'Use four continuous motion stages when the shot needs a larger progression, while keeping one uninterrupted shot.',
        'Camera movement is allowed as continuous push-in, pull-back, pan, track, or similar smooth movement, but do not add scene cuts, time jumps, new people, unrelated locations, or camera angle jumps.',
      ]
    case 'long_promptrelay':
      return [
        `Workflow profile: ${policy}.`,
        'VBVR / PromptRelay structured format is required for enhanced_prompt.',
        'Single-image long PromptRelay mode: keep one continuous shot and allow gradual continuous movement for the longer duration.',
        'The enhanced_prompt must include explicit GLOBAL: and numbered LOCAL sections.',
        'GLOBAL: describe only the visible environment and visible subjects from the source frame.',
        'LOCAL 1:, LOCAL 2:, and LOCAL 3: must each describe one small continuous time progression; use LOCAL 4: and LOCAL 5: when the longer workflow needs more segments.',
        'Each LOCAL n: section must describe continuous visible-subject action and continuous allowed camera movement only; do not add scene changes, time jumps, new people, unrelated locations, or camera angle jumps.',
      ]
    case 'first_last_frame':
      return [
        `Workflow profile: ${policy}.`,
        'First-to-last-frame bridge mode: connect the start frame to the end frame with natural continuous motion.',
        'Continuous camera movement is allowed when it helps bridge the two frames, but do not add new people, new locations, scene cuts, time jumps, or camera angle jumps.',
      ]
    case 'micro_detail':
      return [
        `Workflow profile: ${policy}.`,
        'VBVR / PromptRelay structured format is required for enhanced_prompt.',
        'Use exactly this section shape: GLOBAL: fixed visible source-frame subject, room, lighting, identity, and composition; LOCAL: micro motion only.',
        'LOCAL: may describe eyes, gaze, blinking, mouth or lip motion, breathing, tiny facial expression, and small finger or hand motion only.',
        'Keep the camera fixed to the source-frame composition; do not introduce large body movement, new people, new locations, or scene cuts.',
      ]
    default:
      if (hasExplicitCameraMovementIntent(originalPrompt)) {
        return [
          `Workflow profile: ${policy}.`,
          'VBVR / PromptRelay structured format is required for enhanced_prompt.',
          'Use exactly this section shape: GLOBAL: fixed visible source-frame subject, room, lighting, identity, and composition; LOCAL: one continuous visible action.',
          'Preserve only the camera movement explicitly requested in the original prompt, keeping the source-frame composition and visible subjects stable.',
          'Do not invent any additional camera path, angle change, parallax, or extra camera travel beyond the original prompt.',
          'GLOBAL: describe only the fixed visible environment and visible subjects; LOCAL: describe only the requested continuous subject motion, lip movement, micro-expression, and explicitly requested camera movement.',
        ]
      }
      return [
        `Workflow profile: ${policy}.`,
        'VBVR / PromptRelay structured format is required for enhanced_prompt.',
        'Use exactly this section shape: GLOBAL: fixed visible source-frame subject, room, lighting, identity, and composition; LOCAL: one continuous visible action.',
        'Keep the source-frame composition locked. For normal single-shot mode, use a locked-off static camera only.',
        'The final enhanced_prompt must keep a fixed camera path and source-frame framing.',
        'GLOBAL: describe only the fixed visible environment and visible subjects; LOCAL: describe only visible-subject motion, lip movement, and micro-expression inside the source-frame composition.',
      ]
  }
}

async function resolveLtx23PromptTextModel(
  userId: string,
  projectId: string,
  modelKey: string,
): Promise<string | null> {
  if (isComfyUiLtx23KjPromptRelayWorkflow(modelKey)) return CODEX_DEFAULT_MODEL_KEY

  const projectConfig = await getProjectModelConfig(projectId, userId)
  if (projectConfig.analysisModel && getProviderKey(projectConfig.analysisModel) !== 'bailian') {
    return projectConfig.analysisModel
  }

  const userConfig = await getUserModelConfig(userId)
  if (userConfig.analysisModel && getProviderKey(userConfig.analysisModel) !== 'bailian') {
    return userConfig.analysisModel
  }

  return null
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
    truncateText(panel.clipContent, 160) && `Low-priority story background only; do not import off-screen people/events: ${truncateText(panel.clipContent, 160)}`,
    truncateText(input.artStyle, 80) && `Project visual style: ${truncateText(input.artStyle, 80)}`,
    buildContinuityContextText(input.continuity),
  ].filter(Boolean)

  return lines.length > 0 ? lines.join('\n') : 'No extra panel metadata was provided.'
}

function buildContinuityContextText(packet: PanelContinuityPacket | null | undefined): string {
  if (!packet) return ''

  const characters = packet.characters.length > 0
    ? packet.characters.map((character) => {
        const details = [
          character.appearance ? `appearance=${character.appearance}` : '',
          character.slot ? `slot=${character.slot}` : '',
        ].filter(Boolean)
        return details.length > 0 ? `${character.name} (${details.join('; ')})` : character.name
      }).join(', ')
    : 'only subjects visible in the source frame'

  const previous = packet.previous
    ? `${packet.previous.description || packet.previous.action}`
    : 'none'
  const next = packet.next
    ? `${packet.next.description || packet.next.action}`
    : 'none'

  return [
    'Continuity packet:',
    `Source text: ${truncateText(packet.sourceText, 180) || 'none'}`,
    `Current shot action: ${truncateText(packet.currentAction, 180) || 'none'}`,
    `Allowed characters: ${characters}`,
    `Location lock: ${packet.location || 'same as source frame'}`,
    `Previous shot context only: ${truncateText(previous, 140)}`,
    `Next shot context only: ${truncateText(next, 140)}`,
    `Forbidden additions: ${packet.forbiddenAdditions.join(', ')}`,
  ].join('\n')
}

function normalizeDialogueText(value: unknown): string {
  return readTrimmedString(value).replace(/\s+/g, ' ')
}

function hasLinkedReferenceAudio(
  voiceLines: Ltx23PromptEnhancementVoiceLine[] | null | undefined,
): boolean {
  return Array.isArray(voiceLines)
    && voiceLines.some((line) => readTrimmedString(line.audioUrl).length > 0)
}

function buildReferenceAudioDialogueContext(
  voiceLines: Ltx23PromptEnhancementVoiceLine[] | null | undefined,
): string {
  const count = Array.isArray(voiceLines) ? voiceLines.length : 0
  return [
    'Reference audio dialogue rules:',
    `1. ${count > 1 ? 'The linked reference audio clips are' : 'The linked reference audio clip is'} the source of spoken words, mouth rhythm, pauses, and timing.`,
    '2. Do not include exact transcript text, quoted dialogue, subtitles, captions, or readable speech text in enhanced_prompt.',
    '3. Describe only visual lip sync, mouth movement, facial motion, posture, and allowed camera movement.',
  ].join('\n')
}

function buildStrictDialogueContextText(
  locale: Locale,
  voiceLines: Ltx23PromptEnhancementVoiceLine[] | null | undefined,
): string {
  if (!Array.isArray(voiceLines) || voiceLines.length === 0) return ''
  if (hasLinkedReferenceAudio(voiceLines)) return buildReferenceAudioDialogueContext(voiceLines)

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
  audioTiming?: ResolvedAudioDrivenVideoTiming | null,
  visualOnlyNoLiteralDialogue = false,
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
      const referenceAudio = readTrimmedString(line.audioUrl)
      const parts = [
        `${index + 1}. ${readTrimmedString(line.speaker) || 'Unknown speaker'}`,
        referenceAudio
          ? 'reference audio clip'
          : visualOnlyNoLiteralDialogue
            ? 'spoken line present; literal words intentionally omitted'
            : truncateText(line.content, 120),
      ].filter(Boolean)
      const durationText = typeof line.audioDuration === 'number' && Number.isFinite(line.audioDuration) && line.audioDuration > 0
        ? ` (${(line.audioDuration / 1000).toFixed(2)}s)`
        : ''
      return `${parts.join(': ')}${durationText}`
    })
    .join('\n')

  const timingPlan = audioTiming
    ? [
        `Audio duration: ${audioTiming.audioDurationSeconds.toFixed(2)} seconds.`,
        `Context-aware target video duration: ${audioTiming.targetDurationSeconds.toFixed(2)} seconds.`,
        `Timing plan: [0.00-${audioTiming.dialogueStartSeconds.toFixed(2)}] pre-roll emotional setup, [${audioTiming.dialogueStartSeconds.toFixed(2)}-${audioTiming.dialogueEndSeconds.toFixed(2)}] ${visualOnlyNoLiteralDialogue ? 'visible speaking/lip motion' : 'exact dialogue/lip motion'}, [${audioTiming.dialogueEndSeconds.toFixed(2)}-${audioTiming.targetDurationSeconds.toFixed(2)}] post-dialogue emotional hold.`,
        `Pre-roll: ${audioTiming.preRollSeconds.toFixed(2)} seconds. Post-roll: ${audioTiming.postRollSeconds.toFixed(2)} seconds.`,
        audioTiming.capped && audioTiming.maxDurationSeconds !== null
          ? `The current workflow maximum is ${audioTiming.maxDurationSeconds.toFixed(2)} seconds; do not exceed it.`
          : '',
      ].filter(Boolean).join('\n')
    : null

  const header = timingPlan
    ? `Linked audio count: ${voiceLines.length}\n${timingPlan}`
    : safeDuration
      ? `Linked audio count: ${voiceLines.length}\nContext-aware target video duration: ${safeDuration.toFixed(2)} seconds.`
    : `Linked audio count: ${voiceLines.length}`

  const strictDialogueContext = visualOnlyNoLiteralDialogue
    ? [
        'KJ visual-only dialogue rules:',
        '1. Do not include literal dialogue, quoted speech, transcript words, subtitles, captions, or readable speech text in enhanced_prompt.',
        '2. Preserve only visible lip and mouth movement, facial performance, gaze, gesture, posture, and their natural timing.',
        '3. Text-artifact prevention is handled by negative conditioning; do not put subtitle or watermark prohibition terms into the positive enhanced_prompt.',
      ].join('\n')
    : buildStrictDialogueContextText(locale, voiceLines)
  return strictDialogueContext
    ? `${header}\nVoice lines:\n${lineSummary}\n\n${strictDialogueContext}`
    : `${header}\nVoice lines:\n${lineSummary}`
}

function resolveKjPromptRelaySegmentCount(durationSeconds: number | null | undefined): number {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 3
  return durationSeconds <= 10 ? 3 : durationSeconds <= 16 ? 4 : 5
}

function resolveKjPromptRelayTotalFrames(input: EnhanceLtx23VideoPromptInput): number | null {
  if (!isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)) return null
  if (typeof input.durationSeconds !== 'number' || !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) return null
  if (typeof input.fps !== 'number' || !Number.isFinite(input.fps) || input.fps <= 0) return null
  return Math.max(
    resolveKjPromptRelaySegmentCount(input.durationSeconds),
    Math.round(input.durationSeconds * input.fps),
  )
}

function readKjPromptRelaySegmentFrames(
  parsed: Record<string, unknown>,
  input: EnhanceLtx23VideoPromptInput,
): number[] | null {
  const raw = parsed.segment_frames
  if (!Array.isArray(raw)) return null
  if (!raw.every((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)) return null

  const expectedCount = resolveKjPromptRelaySegmentCount(input.durationSeconds)
  const totalFrames = resolveKjPromptRelayTotalFrames(input)
  if (totalFrames === null || raw.length !== expectedCount) return null
  if (raw.reduce((sum, value) => sum + value, 0) !== totalFrames) return null
  if (new Set(raw).size <= 1) return null
  return [...raw]
}

function buildKjFallbackSegmentFrames(input: EnhanceLtx23VideoPromptInput): number[] {
  const segmentCount = resolveKjPromptRelaySegmentCount(input.durationSeconds)
  const totalFrames = resolveKjPromptRelayTotalFrames(input) ?? segmentCount
  const weights = segmentCount === 3
    ? [2, 5, 3]
    : segmentCount === 4
      ? [2, 4, 5, 3]
      : [2, 3, 5, 4, 2]
  const remainingFrames = Math.max(0, totalFrames - segmentCount)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const exactExtras = weights.map((weight) => (remainingFrames * weight) / totalWeight)
  const frames = exactExtras.map((value) => 1 + Math.floor(value))
  const unassigned = totalFrames - frames.reduce((sum, value) => sum + value, 0)
  const addOrder = exactExtras
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (let index = 0; index < unassigned; index += 1) {
    frames[addOrder[index % addOrder.length].index] += 1
  }
  return frames
}

function appendKjPromptRelayLengths(prompt: string, frames: readonly number[]): string {
  return `${prompt.trim()}\nLENGTHS: ${frames.join(', ')}`
}

function buildKjPromptRelayTimingLines(input: EnhanceLtx23VideoPromptInput): string[] {
  if (!isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)) return []
  if (typeof input.durationSeconds !== 'number' || !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) return []
  if (typeof input.fps !== 'number' || !Number.isFinite(input.fps) || input.fps <= 0) return []

  const segmentCount = resolveKjPromptRelaySegmentCount(input.durationSeconds)
  const totalFrames = resolveKjPromptRelayTotalFrames(input)
  if (totalFrames === null) return []

  return [
    `Use exactly ${segmentCount} numbered LOCAL sections for this request.`,
    `Total frame budget: ${totalFrames} frames.`,
    'Analyze the concrete action beats and their natural timing before assigning frames. Give preparation, main motion, and settling only the time each beat actually needs; do not divide the timeline evenly.',
    `Return a JSON field named segment_frames with exactly ${segmentCount} positive integer frame counts. They must sum to ${totalFrames}, must not all be equal, and their order must match LOCAL 1 through LOCAL ${segmentCount}.`,
    `Think in seconds at ${Math.round(input.fps)} fps, then convert the chosen durations to exact frame counts. Do not put LENGTHS: inside enhanced_prompt; the application will add validated timing metadata.`,
    'Visual-only dialogue rule: do not copy literal dialogue, quoted speech, transcript words, subtitles, captions, or readable speech text into enhanced_prompt. Describe only visible lip and mouth movement, expression, gaze, gesture, posture, and their timing.',
    'Text-artifact prevention is handled by negative conditioning. Do not put subtitle, caption, text-overlay, or watermark prohibition terms into the positive enhanced_prompt.',
  ]
}

function buildGenerationContextText(input: EnhanceLtx23VideoPromptInput): string {
  const promptPolicy = resolveLtx23PromptPolicy(input.modelKey)
  const cameraPolicyLines = buildCameraPolicyLines(promptPolicy, input.originalPrompt)
  const allowedSubjects = input.continuity?.characters?.length
    ? input.continuity.characters.map((character) => character.name).filter(Boolean)
    : parseNameList(input.panel.characters)
  const allowedSubjectText = allowedSubjects.length > 0
    ? `Allowed on-screen subjects from panel metadata: ${allowedSubjects.join(', ')}. Do not add any other person.`
    : 'Allowed on-screen subjects: only the subjects visibly present in the source frame.'
  const timingLines = input.audioTiming
    ? [
        `Dialogue should start around ${input.audioTiming.dialogueStartSeconds.toFixed(2)} seconds and end around ${input.audioTiming.dialogueEndSeconds.toFixed(2)} seconds.`,
        `Keep ${input.audioTiming.preRollSeconds.toFixed(2)} seconds for visual/emotional setup before speech and ${input.audioTiming.postRollSeconds.toFixed(2)} seconds for aftertaste after speech.`,
      ]
    : []
  const motionStrengthLine = isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)
    ? (() => {
        const motionStrength = normalizeLtx23KjMotionStrength(input.motionStrength)
        return `Motion strength: ${motionStrength} (${resolveLtx23KjMotionStrengthLabel(motionStrength)}). Keep every LOCAL stage consistent with this motion level.`
      })()
    : ''
  const promptRelayTimingLines = buildKjPromptRelayTimingLines(input)

  const lines = [
    'Target model: ComfyUI LTX2.3 image-to-video.',
    'The source frame and current panel are authoritative. If story context, neighboring shots, or global plot conflict with the source frame, ignore them.',
    allowedSubjectText,
    'Do not introduce new people, extra bodies, crowds, props, locations, plot events, scene cuts, jump cuts, or camera angle changes not already implied by the source frame.',
    ...cameraPolicyLines,
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
    ...promptRelayTimingLines,
    motionStrengthLine,
    ...timingLines,
  ].filter(Boolean)

  return lines.join('\n')
}

function buildVisualContinuityConstraint(input: EnhanceLtx23VideoPromptInput, policy: Ltx23PromptPolicy): string {
  const allowedSubjects = input.continuity?.characters?.length
    ? input.continuity.characters.map((character) => character.name).filter(Boolean)
    : parseNameList(input.panel.characters)
  const subjectText = allowedSubjects.length > 0
    ? `Allowed visible subjects: ${allowedSubjects.join(', ')}.`
    : 'Allowed visible subjects: only the people already visible in the source frame.'
  const originalPromptHasCameraMovement = hasExplicitCameraMovementIntent(input.originalPrompt)
  const originalPromptHasOrbit = hasExplicitOrbitCameraMotionIntent(input.originalPrompt)
  const cameraConstraint = allowsCameraMovement(policy)
    ? 'Keep one continuous shot. Camera movement is allowed, but do not add scene cuts, time jumps, new people, or unrelated locations.'
    : originalPromptHasCameraMovement
      ? originalPromptHasOrbit
        ? 'Preserve only the original prompt\'s explicitly requested orbit or rotation camera movement; keep it continuous and do not add extra camera travel, scene cuts, time jumps, new people, or unrelated locations.'
        : 'Preserve only the original prompt\'s explicitly requested camera movement. Keep the same frontal angle, source-frame composition, and visible subject count without any additional camera path.'
      : 'Use a locked-off static camera with fixed source-frame composition.'

  return [
    'Source-frame continuity lock:',
    subjectText,
    'Do not add new people, extra bodies, crowds, new props, new locations, scene cuts, time jumps, or unrelated plot actions.',
    'Do not add subtitles, captions, text overlays, watermarks, Chinese characters, signs, UI text, or any readable text inside the image.',
    'Every frame must stay in the same source-image room with the same visible subject only; never cut to another room, hallway, crowd, uniformed people, guards, police, or background extras.',
    cameraConstraint,
    'Animate only the visible subject posture, face, mouth, and hands from the current frame.',
    'Do not turn reflections, background shapes, shadows, or blurred details into new characters.',
    'Keep the final frame close to the source image with the same visible character count and same room layout.',
  ].join(' ')
}

function readEnhancedPromptField(parsed: Record<string, unknown>): string {
  return readTrimmedString(parsed.enhanced_prompt)
}

const PROMPT_RELAY_GLOBAL_MARKER_PATTERN = /\bGLOBAL\s*[:\uFF1A]/i
const PROMPT_RELAY_LOCAL_MARKER_PATTERN = /\bLOCAL(?:\s+\d+)?\s*[:\uFF1A]/i
const PROMPT_RELAY_NUMBERED_LOCAL_MARKER_PATTERN = /\bLOCAL\s+\d+\s*[:\uFF1A]/gi

function ltx23PromptPolicyRequiresStructuredOutput(policy: Ltx23PromptPolicy): boolean {
  return policy === 'stable_single_image'
    || policy === 'micro_detail'
    || policy === 'large_motion_single_image'
    || policy === 'long_promptrelay'
}

function getMinimumNumberedLocalSectionCount(policy: Ltx23PromptPolicy): number {
  if (policy === 'large_motion_single_image') return 4
  if (policy === 'long_promptrelay') return 3
  return 0
}

function countNumberedLocalSections(prompt: string): number {
  return Array.from(prompt.matchAll(PROMPT_RELAY_NUMBERED_LOCAL_MARKER_PATTERN)).length
}

function readNumberedLocalSectionNumbers(prompt: string): number[] {
  return Array.from(prompt.matchAll(/\bLOCAL\s+(\d+)\s*[:\uFF1A]/gi))
    .map((match) => Number(match[1]))
}

function hasRequiredPromptRelayStructure(
  prompt: string,
  policy: Ltx23PromptPolicy,
  input: EnhanceLtx23VideoPromptInput,
): boolean {
  if (!ltx23PromptPolicyRequiresStructuredOutput(policy)) return true
  if (!PROMPT_RELAY_GLOBAL_MARKER_PATTERN.test(prompt)) return false
  if (!PROMPT_RELAY_LOCAL_MARKER_PATTERN.test(prompt)) return false

  if (isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)) {
    const expectedCount = resolveKjPromptRelaySegmentCount(input.durationSeconds)
    const sectionNumbers = readNumberedLocalSectionNumbers(prompt)
    const relaySegments = splitPromptRelayLocalSegments(prompt)
    if (/\bLOCAL\s*[:\uFF1A]/i.test(prompt)) return false
    if (/\bLENGTHS\s*[:\uFF1A]/i.test(prompt)) return false
    return sectionNumbers.length === expectedCount
      && sectionNumbers.every((value, index) => value === index + 1)
      && relaySegments.length === expectedCount
  }

  const minimumNumberedLocalSections = getMinimumNumberedLocalSectionCount(policy)
  if (minimumNumberedLocalSections === 0) return true

  return countNumberedLocalSections(prompt) >= minimumNumberedLocalSections
}

const PROMPT_ANCHOR_STOPWORDS = new Set([
  'the',
  'and',
  'with',
  'while',
  'into',
  'from',
  'that',
  'this',
  'shot',
  'action',
  'prompt',
  'intent',
  'creator',
  'current',
  'source',
  'frame',
  'panel',
  'global',
  'local',
  'scene',
  'video',
])

function collectPromptAnchors(value: string): string[] {
  const normalized = value.toLowerCase()
  const anchors = new Set<string>()

  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const sequence = match[0] || ''
    if (sequence.length <= 4) {
      anchors.add(sequence)
      continue
    }
    for (let index = 0; index < sequence.length - 1; index += 1) {
      anchors.add(sequence.slice(index, index + 2))
    }
  }

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9-]{2,}/g)) {
    const token = match[0] || ''
    if (!PROMPT_ANCHOR_STOPWORDS.has(token)) {
      anchors.add(token)
    }
  }

  return Array.from(anchors)
}

function isEnhancedPromptAnchoredToOriginal(originalPrompt: string, enhancedPrompt: string): boolean {
  const anchors = collectPromptAnchors(originalPrompt)
  if (anchors.length === 0) return true

  const normalizedEnhanced = enhancedPrompt.toLowerCase()
  return anchors.some((anchor) => normalizedEnhanced.includes(anchor))
}

function buildVerbatimDialogueConstraint(
  locale: Locale,
  voiceLines: Ltx23PromptEnhancementVoiceLine[] | null | undefined,
): string {
  if (!Array.isArray(voiceLines) || voiceLines.length === 0) return ''
  if (hasLinkedReferenceAudio(voiceLines)) {
    return 'Match mouth movement, pauses, and timing to the linked reference audio. Do not include exact transcript text, quoted dialogue, subtitles, captions, or readable speech text in the visual prompt.'
  }

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

function buildLtx23DialogueConstraint(input: EnhanceLtx23VideoPromptInput): string {
  if (!isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)) {
    return buildVerbatimDialogueConstraint(input.locale, input.linkedVoiceLines)
  }
  if (!Array.isArray(input.linkedVoiceLines) || input.linkedVoiceLines.length === 0) return ''
  return 'The visible speaker performs natural speech with rhythmic lip movement and mouth movement, facial expression, gaze, gesture, and posture matched to the action timing.'
}

function collectKjKnownDialogue(input: EnhanceLtx23VideoPromptInput): string[] {
  return [
    input.panel.srtSegment,
    ...(input.linkedVoiceLines ?? []).map((line) => line.content),
  ]
    .map((value) => readTrimmedString(value))
    .filter(Boolean)
}

function sanitizeKjPrompt(value: string, input: EnhanceLtx23VideoPromptInput): string {
  return sanitizeLtx23KjNoSubtitlesPrompt(value, collectKjKnownDialogue(input))
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

function sanitizeKjPromptRelayReservedSyntax(value: string): string {
  return value
    .replace(/\b(GLOBAL|LOCAL(?:\s+\d+)?|LENGTHS)\s*[:\uFF1A]/gi, '$1 -')
    .replace(/\|/g, ',')
}

function stabilizeNormalSingleShotPrompt(basePrompt: string, input: EnhanceLtx23VideoPromptInput, policy: Ltx23PromptPolicy): string {
  if (input.generationMode === 'firstlastframe' || allowsCameraMovement(policy)) return basePrompt
  if (addsUnrequestedOrbitCameraMotion(input.originalPrompt, basePrompt)) return input.originalPrompt
  if (hasExplicitCameraMovementIntent(input.originalPrompt)) return basePrompt

  return basePrompt
    .replace(/\b(?:tiny\s+within-frame\s+)?(?:parallax|camera\s+parallax)(?:\s+simulating\s+[^,.]+)?/gi, 'locked-off static camera')
    .replace(/\b(?:slow(?:ly)?\s+)?(?:circling|circle|orbits?|orbiting|pans?|panning|tracks?|tracking|dolly|dolly(?:ing)?|zooms?|zooming|travels?|traveling|travelling)\b/gi, 'locked-off static camera')
}

function appendLtx23SafetyConstraints(
  basePrompt: string,
  dialogueConstraint: string,
  input: EnhanceLtx23VideoPromptInput,
): string {
  const promptPolicy = resolveLtx23PromptPolicy(input.modelKey)
  const stabilizedPrompt = stabilizeNormalSingleShotPrompt(basePrompt, input, promptPolicy)
  const safeDialogueConstraint = isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)
    ? sanitizeKjPromptRelayReservedSyntax(dialogueConstraint)
    : dialogueConstraint
  const withDialogue = appendDialogueConstraint(stabilizedPrompt, safeDialogueConstraint, input.locale)
  const visualConstraint = buildVisualContinuityConstraint(input, promptPolicy)
  const constrainedPrompt = appendDialogueConstraint(withDialogue, visualConstraint, 'en')
  return isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)
    ? sanitizeKjPrompt(constrainedPrompt, input)
    : constrainedPrompt
}

function isSmartVbvrWorkflowModel(modelKey: string | null | undefined): boolean {
  return readTrimmedString(modelKey).toLowerCase().includes('t8-smart-vbvr')
}

function shouldUseSmartVbvrAudioPrompt(input: EnhanceLtx23VideoPromptInput): boolean {
  return isSmartVbvrWorkflowModel(input.modelKey) && hasLinkedReferenceAudio(input.linkedVoiceLines)
}

const SMART_VBVR_PACKET_LINE_PATTERN =
  /^\s*(?:Panel continuity packet|Mode|Source text|Current shot action|Visible characters|Location lock|Shot\/camera lock|Props lock|Previous shot context|Next shot context|Dialogue lines|Target duration|Creator prompt intent|Hard constraints|Source-frame continuity lock|Allowed visible subjects|Forbidden additions)\s*:/i
const SMART_VBVR_NEGATIVE_LINE_PATTERN =
  /\b(?:do\s+not|don't|must\s+not|cannot|can't|without|avoid|never|forbidden|no\s+(?:subtitles?|captions?|readable\s+text|new\s+people|new\s+characters|extra\s+people|rotation|profile\s+turns?|head\s+turns?|crowds?|guards?|police|scene\s+cuts?|scene\s+changes?))\b|(?:\u4e0d\u8981|\u4e0d\u5f97|\u4e0d\u80fd|\u7981\u6b62|\u907f\u514d)/iu
const SMART_VBVR_UNSTABLE_SUBJECT_PATTERN =
  /\b(?:subtitles?|captions?|watermarks?|crowds?|guards?|police|profile\s+turns?|head\s+turns?|extra\s+people|new\s+people|new\s+characters|rotation|rotating|orbiting|spinning|scene\s+cuts?|scene\s+changes?)\b/i
const SMART_VBVR_AUDIO_CLEAN_FRAME_GUARD =
  'The lower portion of the frame stays clean and unobstructed, with clothing, desk edge, and room background remaining visible and free of glyph-like marks.'

function cleanSmartVbvrPositiveText(value: unknown, maxLength = 300): string {
  const text = readTrimmedString(value)
  if (!text) return ''

  const cleaned = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0
      && !SMART_VBVR_PACKET_LINE_PATTERN.test(line)
      && !SMART_VBVR_NEGATIVE_LINE_PATTERN.test(line)
      && !SMART_VBVR_UNSTABLE_SUBJECT_PATTERN.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return truncateText(cleaned, maxLength)
}

function formatSmartVbvrVisibleSubjects(input: EnhanceLtx23VideoPromptInput): string {
  const continuityNames = input.continuity?.characters
    ?.map((character) => readTrimmedString(character.name))
    .filter(Boolean) ?? []
  const panelNames = parseNameList(input.panel.characters)
  const names = continuityNames.length > 0 ? continuityNames : panelNames
  if (names.length === 0) return 'the visible speaker'
  return names.slice(0, 4).join(', ')
}

function appendSmartVbvrAudioCleanFrameGuard(prompt: string): string {
  const text = readTrimmedString(prompt)
  if (!text) return SMART_VBVR_AUDIO_CLEAN_FRAME_GUARD
  if (text.toLowerCase().includes('lower portion of the frame stays clean')) return text
  return [
    text,
    SMART_VBVR_AUDIO_CLEAN_FRAME_GUARD,
  ].join('\n')
}

function buildSmartVbvrAudioPrompt(input: EnhanceLtx23VideoPromptInput): string {
  const location = cleanSmartVbvrPositiveText(input.continuity?.location || input.panel.location, 120)
    || 'the same source-image room'
  const subjects = formatSmartVbvrVisibleSubjects(input)
  const shotType = cleanSmartVbvrPositiveText(input.continuity?.shotType || input.panel.shotType, 80)
    || 'frontal close-up'
  const action = cleanSmartVbvrPositiveText(input.continuity?.currentAction, 300)
    || cleanSmartVbvrPositiveText(input.panel.description, 300)
    || cleanSmartVbvrPositiveText(input.originalPrompt, 300)
    || 'the visible speaker speaks calmly'

  return [
    `GLOBAL: ${location}, ${subjects}, ${shotType}, same source-frame composition, stable identity, clothing, lighting, desk, and room layout.`,
    `LOCAL: ${action}. The visible speaker follows the requested head and gaze direction while speaking with subtle reference audio mouth movement, tiny facial motion, restrained breathing, and a restrained slow push-in. ${SMART_VBVR_AUDIO_CLEAN_FRAME_GUARD}`,
  ].join('\n')
}

function sanitizeSmartVbvrAudioPromptCandidate(
  prompt: string,
  input: EnhanceLtx23VideoPromptInput,
): string {
  const cleaned = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0
      && !SMART_VBVR_PACKET_LINE_PATTERN.test(line)
      && !SMART_VBVR_NEGATIVE_LINE_PATTERN.test(line)
      && !SMART_VBVR_UNSTABLE_SUBJECT_PATTERN.test(line))
    .join('\n')
    .trim()

  if (PROMPT_RELAY_GLOBAL_MARKER_PATTERN.test(cleaned) && PROMPT_RELAY_LOCAL_MARKER_PATTERN.test(cleaned)) {
    if (/\breference[-\s]audio\b/i.test(cleaned) && /\bmouth movement\b/i.test(cleaned)) {
      return appendSmartVbvrAudioCleanFrameGuard(cleaned)
    }
    return appendSmartVbvrAudioCleanFrameGuard([
      cleaned,
      'Match mouth movement and timing to the reference audio with subtle lip motion.',
    ].join('\n'))
  }

  return buildSmartVbvrAudioPrompt(input)
}

function buildLtx23FallbackPrompt(
  originalPrompt: string,
  dialogueConstraint: string,
  input: EnhanceLtx23VideoPromptInput,
): string {
  if (shouldUseSmartVbvrAudioPrompt(input)) {
    return buildSmartVbvrAudioPrompt(input)
  }
  if (isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)) {
    const segmentCount = resolveKjPromptRelaySegmentCount(input.durationSeconds)
    const safeOriginalPrompt = sanitizeKjPromptRelayReservedSyntax(
      sanitizeKjPrompt(originalPrompt, input),
    )
    const localSections = Array.from({ length: segmentCount }, (_, index) => {
      if (index === 0) {
        return `LOCAL 1: Begin the current-shot action continuously: ${safeOriginalPrompt}`
      }
      if (index === segmentCount - 1) {
        return `LOCAL ${index + 1}: Settle the same continuous current-shot action without adding a new event.`
      }
      return `LOCAL ${index + 1}: Continue the same current-shot action smoothly through this interval.`
    })
    const structuredFallback = [
      'GLOBAL: Preserve the exact source-image subjects, environment, lighting, identity, positions, and composition.',
      ...localSections,
    ].join('\n')
    const finalizedFallback = appendLtx23SafetyConstraints(
      structuredFallback,
      dialogueConstraint,
      input,
    )
    if (splitPromptRelayLocalSegments(finalizedFallback).length === segmentCount) {
      return appendKjPromptRelayLengths(finalizedFallback, buildKjFallbackSegmentFrames(input))
    }

    const minimalFallback = [
      'GLOBAL: Preserve the exact source-image subjects, environment, lighting, identity, positions, and composition.',
      ...Array.from({ length: segmentCount }, (_, index) => (
        `LOCAL ${index + 1}: Continue the same current-shot action smoothly through this interval.`
      )),
    ].join('\n')
    return appendKjPromptRelayLengths(
      appendLtx23SafetyConstraints(minimalFallback, dialogueConstraint, input),
      buildKjFallbackSegmentFrames(input),
    )
  }
  return appendLtx23SafetyConstraints(originalPrompt, dialogueConstraint, input)
}

function finalizeLtx23Prompt(
  prompt: string,
  dialogueConstraint: string,
  input: EnhanceLtx23VideoPromptInput,
): string {
  if (shouldUseSmartVbvrAudioPrompt(input)) {
    return sanitizeSmartVbvrAudioPromptCandidate(prompt, input)
  }
  return appendLtx23SafetyConstraints(prompt, dialogueConstraint, input)
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
    const dialogueConstraint = buildLtx23DialogueConstraint(input)
    return {
      prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
      enhanced: false,
      textModel: null,
    }
  }

  const textModel = await resolveLtx23PromptTextModel(input.userId, input.projectId, input.modelKey)
  if (!textModel) {
    const dialogueConstraint = buildLtx23DialogueConstraint(input)
    return {
      prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
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
        original_prompt: isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)
          ? sanitizeKjPrompt(originalPrompt, input)
          : originalPrompt,
        panel_context: isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)
          ? sanitizeKjPrompt(buildPanelContextText(input), input)
          : buildPanelContextText(input),
        character_context: buildCharacterContextText(characters),
        audio_context: buildAudioContextText(
          input.locale,
          input.linkedVoiceLines,
          input.durationSeconds,
          input.audioTiming,
          isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey),
        ),
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
    const dialogueConstraint = buildLtx23DialogueConstraint(input)
    const promptPolicy = resolveLtx23PromptPolicy(input.modelKey)
    const kjSegmentFrames = isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)
      ? readKjPromptRelaySegmentFrames(parsed, input)
      : null
    if (!enhancedPrompt) {
      return {
        prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel,
      }
    }
    if (!hasRequiredPromptRelayStructure(enhancedPrompt, promptPolicy, input)) {
      return {
        prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel,
      }
    }
    if (!isEnhancedPromptAnchoredToOriginal(originalPrompt, enhancedPrompt)) {
      return {
        prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel: null,
      }
    }
    if (addsUnrequestedOrbitCameraMotion(originalPrompt, enhancedPrompt)) {
      return {
        prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel: null,
      }
    }

    const finalPrompt = finalizeLtx23Prompt(enhancedPrompt, dialogueConstraint, input)
    if (!hasRequiredPromptRelayStructure(finalPrompt, promptPolicy, input)) {
      return {
        prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel,
      }
    }
    if (isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey) && !kjSegmentFrames) {
      return {
        prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel,
      }
    }

    return {
      prompt: kjSegmentFrames
        ? appendKjPromptRelayLengths(finalPrompt, kjSegmentFrames)
        : finalPrompt,
      enhanced: finalPrompt !== originalPrompt,
      textModel,
    }
  } catch {
    const dialogueConstraint = buildLtx23DialogueConstraint(input)
    return {
      prompt: buildLtx23FallbackPrompt(originalPrompt, dialogueConstraint, input),
      enhanced: false,
      textModel,
    }
  }
}
