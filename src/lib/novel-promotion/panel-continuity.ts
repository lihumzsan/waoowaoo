export type PanelContinuityCharacter = {
  name: string
  appearance?: string | null
  slot?: string | null
}

export type PanelContinuityPanelLike = {
  id?: string | null
  panelIndex?: number | null
  description?: string | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  videoPromptEditedByUser?: boolean | null
  firstLastFramePrompt?: string | null
  firstLastFramePromptEditedByUser?: boolean | null
  location?: string | null
  characters?: string | null
  props?: string | null
  srtSegment?: string | null
  shotType?: string | null
  cameraMove?: string | null
  sceneType?: string | null
}

export type PanelContinuityDialogueLine = {
  speaker?: string | null
  content: string
  audioDuration?: number | null
}

export type PanelContinuityNeighbor = {
  panelIndex: number | null
  description: string
  action: string
  location: string
  characters: PanelContinuityCharacter[]
}

export type PanelContinuityPacket = {
  panelId: string | null
  panelIndex: number | null
  sourceText: string
  currentAction: string
  location: string
  shotType: string
  cameraMove: string
  sceneType: string
  characters: PanelContinuityCharacter[]
  props: string
  previous: PanelContinuityNeighbor | null
  next: PanelContinuityNeighbor | null
  dialogueLines: PanelContinuityDialogueLine[]
  targetDurationSeconds: number | null
  allowedActions: string[]
  forbiddenAdditions: string[]
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function compactText(value: unknown, maxLength: number): string {
  const text = readTrimmedString(value).replace(/\s+/g, ' ')
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`
}

const ENGLISH_CAMERA_MOTION_PATTERN = /\b(?:camera\s+)?(?:push(?:es|ing)?\s*in|push-in|pull(?:s|ing)?\s*(?:back|out)|pan(?:s|ning)?|track(?:s|ing)?|doll(?:y|ies|ying)|zoom(?:s|ing)?|orbit(?:s|ing)?|circl(?:e|es|ing)|spin(?:s|ning)?|rotat(?:e|es|ing|ion)|travel(?:s|ing|ling)?)\b/i
const ENGLISH_ORBIT_CAMERA_PATTERN = /\b(?:camera\s+)?(?:orbit(?:s|ing)?|circl(?:e|es|ing)|spin(?:s|ning)?|rotat(?:e|es|ing|ion)|360(?:[-\s]?degree)?)\b/i
const CHINESE_CAMERA_MOTION_PATTERN = /(?:\u955c\u5934|\u6444\u5f71\u673a|\u76f8\u673a)?[^。！？；，,.!?]{0,16}(?:\u63a8\u8fd1|\u63a8\u5165|\u62c9\u8fdc|\u62c9\u5f00|\u5e73\u79fb|\u8ddf\u968f|\u8ddf\u62cd|\u73af\u7ed5|\u56f4\u7ed5|\u7ed5\u7740|\u7ed5\u884c|\u7ed5\u5708|\u8f6c\u5708|\u65cb\u8f6c)/u
const CHINESE_ORBIT_CAMERA_PATTERN = /(?:\u955c\u5934|\u6444\u5f71\u673a|\u76f8\u673a)?[^。！？；，,.!?]{0,16}(?:\u73af\u7ed5|\u56f4\u7ed5|\u7ed5\u7740|\u7ed5\u884c|\u7ed5\u5708|\u8f6c\u5708|\u65cb\u8f6c)/u

function hasExplicitCameraMovementIntent(value: string | null | undefined): boolean {
  const text = readTrimmedString(value)
  if (!text) return false
  return ENGLISH_CAMERA_MOTION_PATTERN.test(text) || CHINESE_CAMERA_MOTION_PATTERN.test(text)
}

function hasExplicitOrbitCameraMotionIntent(value: string | null | undefined): boolean {
  const text = readTrimmedString(value)
  if (!text) return false
  return ENGLISH_ORBIT_CAMERA_PATTERN.test(text) || CHINESE_ORBIT_CAMERA_PATTERN.test(text)
}

function buildCameraContinuityConstraint(packet: PanelContinuityPacket, basePrompt: string): string {
  const intentText = [basePrompt, packet.currentAction, packet.cameraMove].filter(Boolean).join(' ')
  if (hasExplicitCameraMovementIntent(intentText)) {
    if (hasExplicitOrbitCameraMotionIntent(intentText)) {
      return 'Preserve only the explicitly requested orbit or rotation camera movement, keeping it continuous and constrained to the source image composition; do not add extra camera travel into unseen areas.'
    }
    return 'Preserve only the explicitly requested camera movement, keeping it subtle, continuous, and constrained to the source image composition. Keep the final framing close to the source frame with the same frontal angle and visible subject count; avoid extreme close-ups, side profiles, face-only crops, and any extra camera travel into unseen areas.'
  }
  return 'Keep the same composition from the source image with a locked camera and no travel into unseen areas.'
}

export function isStructuredMultiShotPrompt(value: unknown): boolean {
  const text = readTrimmedString(value)
  if (!text) return false

  const hasGlobalLocal = /^\s*GLOBAL\s*:/im.test(text)
    && /^\s*LOCAL(?:\s+\d+)?\s*:/im.test(text)
  const timedSegments = text.match(/\[\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*\]/g) ?? []
  const shotMarkers = text.match(/^\s*(?:Scene|Shot)\s*\d+\s*:/gim) ?? []

  return hasGlobalLocal || timedSegments.length >= 2 || shotMarkers.length >= 2
}

function readContinuityVideoPrompt(panel: PanelContinuityPanelLike): string {
  const prompt = readTrimmedString(panel.videoPrompt)
  if (!prompt) return ''
  if (isStructuredMultiShotPrompt(prompt)) return ''
  return prompt
}

function readContinuityFirstLastPrompt(panel: PanelContinuityPanelLike): string {
  const prompt = readTrimmedString(panel.firstLastFramePrompt)
  if (!prompt) return ''
  if (isStructuredMultiShotPrompt(prompt)) return ''
  return prompt
}

export function pickPanelContinuityActionText(panel: PanelContinuityPanelLike): string {
  return readContinuityVideoPrompt(panel)
    || readTrimmedString(panel.description)
    || readTrimmedString(panel.srtSegment)
    || readTrimmedString(panel.imagePrompt)
}

export function pickPanelContinuityBasePrompt(
  panel: PanelContinuityPanelLike,
  options?: { includeFirstLastPrompt?: boolean },
): string {
  const firstLastPrompt = options?.includeFirstLastPrompt
    ? readContinuityFirstLastPrompt(panel)
    : ''
  return firstLastPrompt
    || readContinuityVideoPrompt(panel)
    || readTrimmedString(panel.description)
    || readTrimmedString(panel.srtSegment)
    || readTrimmedString(panel.imagePrompt)
}

function uniqueByName(items: PanelContinuityCharacter[]): PanelContinuityCharacter[] {
  const seen = new Set<string>()
  const next: PanelContinuityCharacter[] = []
  for (const item of items) {
    const name = readTrimmedString(item.name)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push({
      name,
      ...(readTrimmedString(item.appearance) ? { appearance: readTrimmedString(item.appearance) } : {}),
      ...(readTrimmedString(item.slot) ? { slot: readTrimmedString(item.slot) } : {}),
    })
  }
  return next
}

export function parseContinuityCharacters(raw: string | null | undefined): PanelContinuityCharacter[] {
  const text = readTrimmedString(raw)
  if (!text) return []

  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) {
      return uniqueByName(parsed.flatMap((item) => {
        if (typeof item === 'string') {
          const name = readTrimmedString(item)
          return name ? [{ name }] : []
        }
        if (!item || typeof item !== 'object') return []
        const record = item as Record<string, unknown>
        const name = readTrimmedString(record.name)
        if (!name) return []
        return [{
          name,
          appearance: readTrimmedString(record.appearance) || null,
          slot: readTrimmedString(record.slot) || null,
        }]
      }))
    }
  } catch {
    // Fall back to delimiter parsing below.
  }

  return uniqueByName(text
    .split(/[\n,\uFF0C\u3001|]/u)
    .map((item) => ({ name: item.trim() }))
    .filter((item) => item.name.length > 0))
}

function buildNeighbor(panel: PanelContinuityPanelLike | null | undefined): PanelContinuityNeighbor | null {
  if (!panel) return null
  return {
    panelIndex: typeof panel.panelIndex === 'number' ? panel.panelIndex : null,
    description: compactText(panel.description, 180),
    action: compactText(pickPanelContinuityActionText(panel), 180),
    location: compactText(panel.location, 80),
    characters: parseContinuityCharacters(panel.characters),
  }
}

export function buildPanelContinuityPacket(params: {
  panel: PanelContinuityPanelLike
  previousPanel?: PanelContinuityPanelLike | null
  nextPanel?: PanelContinuityPanelLike | null
  dialogueLines?: PanelContinuityDialogueLine[] | null
  targetDurationSeconds?: number | null
}): PanelContinuityPacket {
  const panel = params.panel
  const characters = parseContinuityCharacters(panel.characters)
  const sourceText = compactText(panel.srtSegment || panel.description || panel.imagePrompt, 240)
  const currentAction = compactText(pickPanelContinuityActionText(panel), 240)
  const allowedActions = [
    currentAction,
    compactText(panel.shotType, 80),
    compactText(panel.cameraMove, 80),
  ].filter((value): value is string => value.length > 0)

  return {
    panelId: readTrimmedString(panel.id) || null,
    panelIndex: typeof panel.panelIndex === 'number' ? panel.panelIndex : null,
    sourceText,
    currentAction,
    location: compactText(panel.location, 100),
    shotType: compactText(panel.shotType, 80),
    cameraMove: compactText(panel.cameraMove, 80),
    sceneType: compactText(panel.sceneType, 80),
    characters,
    props: compactText(panel.props, 100),
    previous: buildNeighbor(params.previousPanel),
    next: buildNeighbor(params.nextPanel),
    dialogueLines: (params.dialogueLines || [])
      .map((line) => ({
        speaker: compactText(line.speaker, 80) || null,
        content: compactText(line.content, 160),
        audioDuration: typeof line.audioDuration === 'number' ? line.audioDuration : null,
      }))
      .filter((line) => line.content.length > 0),
    targetDurationSeconds:
      typeof params.targetDurationSeconds === 'number' && Number.isFinite(params.targetDurationSeconds) && params.targetDurationSeconds > 0
        ? Number(params.targetDurationSeconds.toFixed(2))
        : null,
    allowedActions,
    forbiddenAdditions: [
      'new characters',
      'extra people',
      'new location',
      'new plot event',
      'scene cut',
      'time jump',
      'unrelated action',
      'unlisted props',
    ],
  }
}

function formatCharacters(characters: PanelContinuityCharacter[]): string {
  if (characters.length === 0) return 'only visible subjects already present in the source image'
  return characters
    .map((character) => {
      const details = [
        character.appearance ? `appearance=${character.appearance}` : '',
        character.slot ? `slot=${character.slot}` : '',
      ].filter(Boolean)
      return details.length > 0 ? `${character.name} (${details.join('; ')})` : character.name
    })
    .join(', ')
}

function formatNeighbor(label: string, neighbor: PanelContinuityNeighbor | null): string {
  if (!neighbor) return `${label}: none`
  const pieces = [
    neighbor.description,
    neighbor.action && `action=${neighbor.action}`,
    neighbor.location && `location=${neighbor.location}`,
    neighbor.characters.length > 0 && `characters=${formatCharacters(neighbor.characters)}`,
  ].filter(Boolean)
  return `${label}: ${pieces.join(' | ')}`
}

export function renderPanelContinuityPrompt(params: {
  packet: PanelContinuityPacket
  basePrompt: string
  generationMode: 'normal' | 'firstlastframe'
  userEdited?: boolean
}): string {
  const basePrompt = compactText(params.basePrompt, 900)
  const packet = params.packet
  const dialogue = packet.dialogueLines.length > 0
    ? packet.dialogueLines.map((line, index) => {
        const speaker = line.speaker ? `${line.speaker}: ` : ''
        const duration = typeof line.audioDuration === 'number' && line.audioDuration > 0
          ? ` (${(line.audioDuration / 1000).toFixed(2)}s audio)`
          : ''
        return `${index + 1}. ${speaker}${line.content}${duration}`
      }).join('\n')
    : 'none'
  const duration = packet.targetDurationSeconds
    ? `${packet.targetDurationSeconds.toFixed(2)} seconds`
    : 'keep the single shot short and stable without adding story beats'
  const neighborContextLines = params.generationMode === 'firstlastframe'
    ? [
        formatNeighbor('Previous shot context', packet.previous),
        formatNeighbor('Next shot context', packet.next),
      ]
    : [
        'Previous shot context: continuity reference only; do not animate previous shot action.',
        'Next shot context: continuity reference only; do not animate next shot action.',
      ]

  return [
    'Panel continuity packet:',
    `Mode: ${params.generationMode === 'firstlastframe' ? 'first-to-last-frame bridge' : 'single-shot image-to-video'}.`,
    `Source text: ${packet.sourceText || 'none'}`,
    `Current shot action: ${packet.currentAction || basePrompt}`,
    `Visible characters: ${formatCharacters(packet.characters)}.`,
    `Location lock: ${packet.location || 'same as source image'}.`,
    `Shot/camera lock: ${[packet.shotType, packet.cameraMove].filter(Boolean).join(', ') || 'preserve source framing'}.`,
    `Props lock: ${packet.props || 'no new props'}.`,
    ...neighborContextLines,
    `Dialogue lines: ${dialogue}`,
    `Target duration: ${duration}.`,
    `Creator prompt intent: ${basePrompt || packet.currentAction || packet.sourceText}`,
    '',
    'Hard constraints:',
    'Use the source image as the visual authority.',
    'Animate only the current shot action. Do not import actions from previous or next shots except as continuity context.',
    'Do not add new characters, extra people, new props, new locations, new plot events, scene cuts, time jumps, or unrelated actions.',
    'Do not add subtitles, captions, text overlays, watermarks, Chinese characters, signs, UI text, or any readable text inside the image.',
    'Every frame must stay in the same source-image room with the same visible subject only; never cut to another room, hallway, crowd, uniformed people, guards, police, or background extras.',
    'Keep character identity, position, clothing, lighting, location, and camera framing consistent with the source image.',
    buildCameraContinuityConstraint(packet, basePrompt),
    'Do not add unrequested hand-to-face gestures, glasses adjustment, head turns, profile turns, or body repositioning.',
    'The final frame must still contain the same visible character count, same location, same lighting, and no newly visible people.',
    packet.dialogueLines.length > 0 && 'If dialogue is listed, mouth movement and timing must match the exact listed dialogue.',
    params.userEdited
      ? 'The creator prompt is an intent layer only; the hard continuity constraints above override conflicting creative wording.'
      : 'Rewrite or interpret the creator prompt only within the hard continuity constraints above.',
  ].filter(Boolean).join('\n')
}

export function buildDefaultFirstLastFramePrompt(params: {
  firstPanel: PanelContinuityPanelLike
  lastPanel: PanelContinuityPanelLike
}): string {
  const firstAction = compactText(
    pickPanelContinuityActionText(params.firstPanel),
    220,
  )
  const lastAction = compactText(
    pickPanelContinuityActionText(params.lastPanel),
    220,
  )
  const sharedCharacters = formatCharacters(parseContinuityCharacters(params.firstPanel.characters))
  return [
    `Start from the first frame: ${firstAction || 'preserve the source frame'}.`,
    `Bridge naturally into the last frame: ${lastAction || 'preserve the target frame'}.`,
    `Keep the same visible characters (${sharedCharacters}), location, lighting, clothing, and camera continuity.`,
    'Use one continuous shot with no scene cut, no new plot beat, no extra characters, and no unrelated action.',
  ].join(' ')
}
