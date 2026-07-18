export const VIDEO_PANEL_PRODUCT_MAX_SECONDS = 10
export const DIALOGUE_BEAT_BUDGET_SECONDS = 9

export type DialogueBeat = {
  beatId: string
  speaker: string
  exactText: string
  sourceText: string
  estimatedSeconds: number
  scene: string | null
  emotion: string | null
  isVoiceover: boolean
}

export type DialogueBeatIssueCode =
  | 'dialogue_over_budget'
  | 'panel_multiple_dialogue_beats'
  | 'dialogue_beat_missing_panel'
  | 'dialogue_beat_duplicate_panel'

export type DialogueBeatIssue = {
  code: DialogueBeatIssueCode
  message: string
  beatId?: string
  panelNumber?: number | null
  details?: Record<string, unknown>
}

type JsonRecord = Record<string, unknown>

type StoryboardPanelLike = JsonRecord & {
  panel_number?: number
  description?: string
  source_text?: string
  video_prompt?: string
  duration?: number
}

type ClipPanelsLike = {
  clipId: string
  finalPanels: StoryboardPanelLike[]
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDialogueText(text: string): string {
  return text
    .replace(/^[\s"'“”‘’「」『』]+/u, '')
    .replace(/[\s"'“”‘’「」『』]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length
}

export function estimateDialogueDurationSeconds(text: string): number {
  const normalized = normalizeDialogueText(text)
  if (!normalized) return 0

  const cjkCount = countMatches(normalized, /[\u3400-\u9fff\uf900-\ufaff]/gu)
  const wordCount = countMatches(normalized, /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/gu)
  const sentencePauseCount = countMatches(normalized, /[。！？!?；;]/gu)
  const softPauseCount = countMatches(normalized, /[，,、]/gu)
  const punctuationSeconds = sentencePauseCount * 0.35 + softPauseCount * 0.18
  const spokenSeconds = (cjkCount / 3.2) + (wordCount / 2.2) + punctuationSeconds

  return Number(Math.max(0.8, spokenSeconds * 1.2).toFixed(2))
}

function splitByPunctuation(text: string): string[] {
  const normalized = normalizeDialogueText(text)
  if (!normalized) return []
  const fragments = normalized.match(/[^。！？!?；;，,、]+[。！？!?；;，,、]?/gu)
  return (fragments && fragments.length > 0 ? fragments : [normalized])
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitLongFragment(fragment: string, budgetSeconds: number): string[] {
  const chars = Array.from(fragment)
  if (chars.length <= 1) return [fragment]

  const maxChars = Math.max(6, Math.floor((budgetSeconds / 1.2) * 3.2) - 2)
  const chunks: string[] = []
  for (let index = 0; index < chars.length; index += maxChars) {
    chunks.push(chars.slice(index, index + maxChars).join('').trim())
  }
  return chunks.filter(Boolean)
}

export function splitDialogueTextIntoBudgetedChunks(
  text: string,
  budgetSeconds = DIALOGUE_BEAT_BUDGET_SECONDS,
): string[] {
  const fragments = splitByPunctuation(text)
  const chunks: string[] = []
  let current = ''

  for (const fragment of fragments) {
    if (estimateDialogueDurationSeconds(fragment) > budgetSeconds) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      chunks.push(...splitLongFragment(fragment, budgetSeconds))
      continue
    }

    const candidate = current ? `${current}${fragment}` : fragment
    if (!current || estimateDialogueDurationSeconds(candidate) <= budgetSeconds) {
      current = candidate
    } else {
      chunks.push(current)
      current = fragment
    }
  }

  if (current) chunks.push(current)

  const normalizedChunks = chunks
    .map(normalizeDialogueText)
    .filter(Boolean)

  const invalidChunk = normalizedChunks.find((chunk) =>
    estimateDialogueDurationSeconds(chunk) > budgetSeconds)
  if (invalidChunk) {
    throw new Error(
      `dialogue_over_budget: unable to split dialogue below ${budgetSeconds}s (${estimateDialogueDurationSeconds(invalidChunk)}s)`,
    )
  }

  return normalizedChunks
}

function readSceneLabel(scene: JsonRecord, sceneIndex: number): string | null {
  const heading = isRecord(scene.heading) ? scene.heading : null
  const location = heading ? readString(heading.location) : ''
  const time = heading ? readString(heading.time) : ''
  const fallback = readString(scene.description)
  const parts = [location, time].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  if (fallback) return fallback.slice(0, 80)
  return `scene ${sceneIndex + 1}`
}

function createBeat(params: {
  clipId: string
  index: number
  speaker: string
  exactText: string
  sourceText: string
  scene: string | null
  emotion: string | null
  isVoiceover: boolean
}): DialogueBeat {
  const exactText = normalizeDialogueText(params.exactText)
  return {
    beatId: `${params.clipId}:dialogue:${params.index}`,
    speaker: params.speaker || (params.isVoiceover ? 'Narrator' : 'Unknown'),
    exactText,
    sourceText: normalizeDialogueText(params.sourceText || exactText),
    estimatedSeconds: estimateDialogueDurationSeconds(exactText),
    scene: params.scene,
    emotion: params.emotion,
    isVoiceover: params.isVoiceover,
  }
}

export function buildDialogueBeatsFromScreenplay(params: {
  clipId: string
  screenplay: unknown
  budgetSeconds?: number
}): DialogueBeat[] {
  const screenplay = isRecord(params.screenplay) ? params.screenplay : null
  const scenes = Array.isArray(screenplay?.scenes) ? screenplay.scenes : []
  const budgetSeconds = params.budgetSeconds ?? DIALOGUE_BEAT_BUDGET_SECONDS
  const beats: DialogueBeat[] = []

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
    const scene = isRecord(scenes[sceneIndex]) ? scenes[sceneIndex] : null
    if (!scene) continue
    const sceneLabel = readSceneLabel(scene, sceneIndex)
    const contentRows = Array.isArray(scene.content) ? scene.content : []
    for (const row of contentRows) {
      if (!isRecord(row)) continue
      const type = readString(row.type).toLowerCase()
      const isDialogue = type === 'dialogue'
      const isVoiceover = type === 'voiceover'
      if (!isDialogue && !isVoiceover) continue

      const rawText = isDialogue ? readString(row.lines) : readString(row.text)
      if (!rawText) continue
      const speaker = readString(row.character) || (isVoiceover ? 'Narrator' : 'Unknown')
      const emotion = readString(row.parenthetical) || null
      const chunks = splitDialogueTextIntoBudgetedChunks(rawText, budgetSeconds)
      for (const chunk of chunks) {
        beats.push(createBeat({
          clipId: params.clipId,
          index: beats.length + 1,
          speaker,
          exactText: chunk,
          sourceText: chunk,
          scene: sceneLabel,
          emotion,
          isVoiceover,
        }))
      }
    }
  }

  return beats
}

export function buildDialogueBeatPromptBlock(beats: DialogueBeat[]): string {
  if (beats.length === 0) {
    return [
      'Dialogue duration policy:',
      `- Product video max: ${VIDEO_PANEL_PRODUCT_MAX_SECONDS}s.`,
      `- Dialogue budget per speaking panel: ${DIALOGUE_BEAT_BUDGET_SECONDS}s.`,
      '- No dialogue beats were detected for this clip.',
    ].join('\n')
  }

  return [
    'Dialogue duration policy:',
    `- Product video max: ${VIDEO_PANEL_PRODUCT_MAX_SECONDS}s.`,
    `- Dialogue budget per speaking panel: ${DIALOGUE_BEAT_BUDGET_SECONDS}s.`,
    '- Each speaking panel may bind exactly one dialogueBeatId.',
    '- Copy the beat exactText into source_text for the speaking panel.',
    '- Do not merge multiple dialogue beats into one panel.',
    '- Reaction panels may share source context but must not set dialogueBeatId.',
    'dialogueBeats JSON:',
    JSON.stringify(beats, null, 2),
  ].join('\n')
}

function normalizeBeatIdList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

export function getPanelDialogueBeatIds(panel: unknown): string[] {
  if (!isRecord(panel)) return []
  const directIds = [
    ...normalizeBeatIdList(panel.dialogueBeatId),
    ...normalizeBeatIdList(panel.dialogue_beat_id),
    ...normalizeBeatIdList(panel.dialogueBeatIds),
    ...normalizeBeatIdList(panel.dialogue_beat_ids),
  ]
  const seen = new Set<string>()
  return directIds.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function inferBeatIdsFromPanel(panel: StoryboardPanelLike, beats: DialogueBeat[]): string[] {
  const explicitIds = getPanelDialogueBeatIds(panel)
  if (explicitIds.length > 0) return explicitIds

  const sourceText = readString(panel.source_text)
  const description = readString(panel.description)
  const prompt = readString(panel.video_prompt)
  const haystack = [sourceText, description, prompt].filter(Boolean).join('\n')
  if (!haystack) return []

  return beats
    .filter((beat) => {
      const exact = beat.exactText
      if (!exact) return false
      if (haystack.includes(exact)) return true
      return sourceText.length >= 2 && exact.includes(sourceText)
    })
    .map((beat) => beat.beatId)
}

function annotatePanelWithBeat(panel: StoryboardPanelLike, beat: DialogueBeat): StoryboardPanelLike {
  return {
    ...panel,
    dialogueBeatId: beat.beatId,
    dialogueSpeaker: beat.speaker,
    estimatedDialogueSeconds: beat.estimatedSeconds,
    source_text: beat.exactText,
    duration: Number(Math.min(
      DIALOGUE_BEAT_BUDGET_SECONDS,
      Math.max(1, Math.ceil(beat.estimatedSeconds)),
    ).toFixed(2)),
  }
}

function stripDialogueBeatFields(panel: StoryboardPanelLike): StoryboardPanelLike {
  const rest = { ...panel }
  delete rest.dialogueBeatId
  delete rest.dialogue_beat_id
  delete rest.dialogueBeatIds
  delete rest.dialogue_beat_ids
  delete rest.dialogueSpeaker
  delete rest.estimatedDialogueSeconds
  return rest
}

function renumberPanels(panels: StoryboardPanelLike[]): StoryboardPanelLike[] {
  return panels.map((panel, index) => ({
    ...panel,
    panel_number: index + 1,
  }))
}

function enforceUniqueDialogueBeatPanels(params: {
  panels: StoryboardPanelLike[]
  dialogueBeats: DialogueBeat[]
}): StoryboardPanelLike[] {
  const beatById = new Map(params.dialogueBeats.map((beat) => [beat.beatId, beat]))
  const covered = new Set<string>()
  const normalized: StoryboardPanelLike[] = []

  for (const panel of params.panels) {
    const availableIds = getPanelDialogueBeatIds(panel)
      .filter((id) => beatById.has(id))
      .filter((id) => !covered.has(id))

    if (availableIds.length === 0) {
      normalized.push(stripDialogueBeatFields(panel))
      continue
    }

    const beat = beatById.get(availableIds[0])
    if (!beat) {
      normalized.push(stripDialogueBeatFields(panel))
      continue
    }

    covered.add(beat.beatId)
    normalized.push(annotatePanelWithBeat(stripDialogueBeatFields(panel), beat))
  }

  return normalized
}

export function alignStoryboardPanelsToDialogueBeats(params: {
  panels: StoryboardPanelLike[]
  dialogueBeats: DialogueBeat[]
}): StoryboardPanelLike[] {
  const { panels, dialogueBeats } = params
  if (dialogueBeats.length === 0) return panels

  const beatById = new Map(dialogueBeats.map((beat) => [beat.beatId, beat]))
  const covered = new Set<string>()
  const nextPanels: StoryboardPanelLike[] = []
  const fallbackPanel = panels[0] || {
    panel_number: 1,
    description: '',
    source_text: '',
  }

  for (const panel of panels) {
    const explicitBeatIds = getPanelDialogueBeatIds(panel)
    const matchedBeatIds = explicitBeatIds.length > 0
      ? explicitBeatIds
      : inferBeatIdsFromPanel(panel, dialogueBeats)
      .filter((id) => beatById.has(id))
    if (matchedBeatIds.length === 0) {
      nextPanels.push(panel)
      continue
    }
    const availableBeatIds = matchedBeatIds.filter((id) => !covered.has(id))
    if (availableBeatIds.length === 0) {
      nextPanels.push(stripDialogueBeatFields(panel))
      continue
    }
    for (const beatId of availableBeatIds) {
      const beat = beatById.get(beatId)
      if (!beat) continue
      covered.add(beat.beatId)
      nextPanels.push(annotatePanelWithBeat(panel, beat))
    }
  }

  for (const beat of dialogueBeats) {
    if (covered.has(beat.beatId)) continue
    nextPanels.push(annotatePanelWithBeat({
      ...fallbackPanel,
      description: readString(fallbackPanel.description) || `${beat.speaker} speaks.`,
      video_prompt: readString(fallbackPanel.video_prompt) || `${beat.speaker} speaks in the current scene.`,
    }, beat))
  }

  return renumberPanels(enforceUniqueDialogueBeatPanels({
    panels: nextPanels,
    dialogueBeats,
  }))
}

export function validateStoryboardDialogueBudget(params: {
  panels: StoryboardPanelLike[]
  dialogueBeats: DialogueBeat[]
  budgetSeconds?: number
}): DialogueBeatIssue[] {
  const budgetSeconds = params.budgetSeconds ?? DIALOGUE_BEAT_BUDGET_SECONDS
  const beatIds = new Set(params.dialogueBeats.map((beat) => beat.beatId))
  const counts = new Map<string, number>()
  const issues: DialogueBeatIssue[] = []

  for (const beat of params.dialogueBeats) {
    if (beat.estimatedSeconds > budgetSeconds) {
      issues.push({
        code: 'dialogue_over_budget',
        beatId: beat.beatId,
        message: `Dialogue beat exceeds ${budgetSeconds}s budget.`,
        details: {
          estimatedSeconds: beat.estimatedSeconds,
          exactText: beat.exactText,
        },
      })
    }
  }

  for (const panel of params.panels) {
    const ids = getPanelDialogueBeatIds(panel).filter((id) => beatIds.has(id))
    if (ids.length > 1) {
      issues.push({
        code: 'panel_multiple_dialogue_beats',
        message: 'A speaking panel is bound to multiple dialogue beats.',
        panelNumber: typeof panel.panel_number === 'number' ? panel.panel_number : null,
        details: { dialogueBeatIds: ids },
      })
    }
    for (const id of ids) {
      counts.set(id, (counts.get(id) || 0) + 1)
    }
  }

  for (const beat of params.dialogueBeats) {
    const count = counts.get(beat.beatId) || 0
    if (count === 0) {
      issues.push({
        code: 'dialogue_beat_missing_panel',
        beatId: beat.beatId,
        message: 'Dialogue beat has no speaking panel.',
      })
    } else if (count > 1) {
      issues.push({
        code: 'dialogue_beat_duplicate_panel',
        beatId: beat.beatId,
        message: 'Dialogue beat is bound to multiple speaking panels.',
        details: { count },
      })
    }
  }

  return issues
}

export function assertStoryboardDialogueBudget(params: {
  clipId: string
  panels: StoryboardPanelLike[]
  dialogueBeats: DialogueBeat[]
}) {
  const issues = validateStoryboardDialogueBudget(params)
  if (issues.length === 0) return
  const preview = issues.slice(0, 3)
    .map((issue) => `${issue.code}${issue.beatId ? `:${issue.beatId}` : ''}`)
    .join(', ')
  throw new Error(`dialogue_budget_invalid:${params.clipId}:${preview}`)
}

function resolveEmotionPrompt(beat: DialogueBeat): string {
  if (beat.emotion) return beat.emotion
  if (beat.isVoiceover) return 'calm narration'
  return 'natural restrained dialogue'
}

export function buildVoiceLineRowsFromDialogueBeats(params: {
  clipPanels: ClipPanelsLike[]
  dialogueBeatsByClipId?: Record<string, DialogueBeat[]>
}): JsonRecord[] {
  const rows: JsonRecord[] = []
  let lineIndex = 1

  for (const clipEntry of params.clipPanels) {
    const beats = params.dialogueBeatsByClipId?.[clipEntry.clipId] || []
    if (beats.length === 0) continue
    const beatById = new Map(beats.map((beat) => [beat.beatId, beat]))

    for (let panelIndex = 0; panelIndex < clipEntry.finalPanels.length; panelIndex += 1) {
      const panel = clipEntry.finalPanels[panelIndex]
      const beatIds = getPanelDialogueBeatIds(panel)
      if (beatIds.length !== 1) continue
      const beat = beatById.get(beatIds[0])
      if (!beat) continue
      rows.push({
        lineIndex,
        speaker: beat.speaker,
        content: beat.exactText,
        emotionPrompt: resolveEmotionPrompt(beat),
        emotionStrength: beat.isVoiceover ? 0.15 : 0.2,
        dialogueBeatId: beat.beatId,
        estimatedSeconds: beat.estimatedSeconds,
        matchedPanel: {
          storyboardId: clipEntry.clipId,
          panelIndex,
        },
      })
      lineIndex += 1
    }
  }

  return rows
}
