import type { Locale } from '@/i18n/routing'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { getProviderKey } from '@/lib/api-config'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { safeParseJsonObject } from '@/lib/json-repair'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { prisma } from '@/lib/prisma'
import type { PanelContinuityPacket } from '@/lib/novel-promotion/panel-continuity'
import { getLtx23WorkflowProfile, type Ltx23PromptPolicy } from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import type { ResolvedAudioDrivenVideoTiming } from '@/lib/video-duration/audio-binding'
import { parseProfileData } from '@/types/character-profile'

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

async function resolveLtx23PromptTextModel(userId: string, projectId: string): Promise<string | null> {
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
  audioTiming?: ResolvedAudioDrivenVideoTiming | null,
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

  const timingPlan = audioTiming
    ? [
        `Audio duration: ${audioTiming.audioDurationSeconds.toFixed(2)} seconds.`,
        `Context-aware target video duration: ${audioTiming.targetDurationSeconds.toFixed(2)} seconds.`,
        `Timing plan: [0.00-${audioTiming.dialogueStartSeconds.toFixed(2)}] pre-roll emotional setup, [${audioTiming.dialogueStartSeconds.toFixed(2)}-${audioTiming.dialogueEndSeconds.toFixed(2)}] exact dialogue/lip motion, [${audioTiming.dialogueEndSeconds.toFixed(2)}-${audioTiming.targetDurationSeconds.toFixed(2)}] post-dialogue emotional hold.`,
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

  const strictDialogueContext = buildStrictDialogueContextText(locale, voiceLines)
  return strictDialogueContext
    ? `${header}\nVoice lines:\n${lineSummary}\n\n${strictDialogueContext}`
    : `${header}\nVoice lines:\n${lineSummary}`
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

function hasRequiredPromptRelayStructure(prompt: string, policy: Ltx23PromptPolicy): boolean {
  if (!ltx23PromptPolicyRequiresStructuredOutput(policy)) return true
  if (!PROMPT_RELAY_GLOBAL_MARKER_PATTERN.test(prompt)) return false
  if (!PROMPT_RELAY_LOCAL_MARKER_PATTERN.test(prompt)) return false

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
  const withDialogue = appendDialogueConstraint(stabilizedPrompt, dialogueConstraint, input.locale)
  const visualConstraint = buildVisualContinuityConstraint(input, promptPolicy)
  return appendDialogueConstraint(withDialogue, visualConstraint, 'en')
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
    const dialogueConstraint = buildVerbatimDialogueConstraint(input.locale, input.linkedVoiceLines)
    return {
      prompt: appendLtx23SafetyConstraints(originalPrompt, dialogueConstraint, input),
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
        audio_context: buildAudioContextText(input.locale, input.linkedVoiceLines, input.durationSeconds, input.audioTiming),
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
    const promptPolicy = resolveLtx23PromptPolicy(input.modelKey)
    if (!enhancedPrompt) {
      return {
        prompt: appendLtx23SafetyConstraints(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel,
      }
    }
    if (!hasRequiredPromptRelayStructure(enhancedPrompt, promptPolicy)) {
      return {
        prompt: appendLtx23SafetyConstraints(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel,
      }
    }
    if (!isEnhancedPromptAnchoredToOriginal(originalPrompt, enhancedPrompt)) {
      return {
        prompt: appendLtx23SafetyConstraints(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel: null,
      }
    }
    if (addsUnrequestedOrbitCameraMotion(originalPrompt, enhancedPrompt)) {
      return {
        prompt: appendLtx23SafetyConstraints(originalPrompt, dialogueConstraint, input),
        enhanced: false,
        textModel: null,
      }
    }

    const finalPrompt = appendLtx23SafetyConstraints(enhancedPrompt, dialogueConstraint, input)

    return {
      prompt: finalPrompt,
      enhanced: finalPrompt !== originalPrompt,
      textModel,
    }
  } catch {
    const dialogueConstraint = buildVerbatimDialogueConstraint(input.locale, input.linkedVoiceLines)
    return {
      prompt: appendLtx23SafetyConstraints(originalPrompt, dialogueConstraint, input),
      enhanced: false,
      textModel,
    }
  }
}
