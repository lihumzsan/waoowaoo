import type { WorkspaceCanvasEditBibleDetails } from '../node-canvas-types'

export interface PlanningStyleGuide {
  readonly visualTone: string | null
  readonly cameraLanguage: string | null
  readonly editingLanguage: string | null
  readonly colorAndLighting: string | null
}

export interface PlanningEntity {
  readonly id: string
  readonly name: string
  readonly aliases: readonly string[]
  readonly summary: string
}

export interface PlanningGlobalBible {
  readonly title: string | null
  readonly logline: string | null
  readonly synopsis: string | null
  readonly characters: readonly PlanningEntity[]
  readonly locations: readonly PlanningEntity[]
  readonly worldRules: readonly string[]
  readonly styleGuide: PlanningStyleGuide
}

export interface PlanningBeat {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly durationSec: number | null
}

export interface PlanningLedgerEntityRef {
  readonly entityType: string
  readonly entityName: string
}

export interface PlanningLedgerEvent {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly entities: readonly PlanningLedgerEntityRef[]
  readonly persistentFacts: readonly string[]
}

export interface PlanningEmotionalCue {
  readonly id: string
  readonly mood: string
  readonly intensity: number | null
  readonly musicPolicy: string | null
  readonly note: string | null
}

export interface ProductionPlanningDetails {
  readonly globalBible: PlanningGlobalBible | null
  readonly beats: readonly PlanningBeat[]
  readonly ledgerEvents: readonly PlanningLedgerEvent[]
  readonly emotionalCues: readonly PlanningEmotionalCue[]
}

function readPlanningRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readPlanningString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readPlanningNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readPlanningStringField(record: Record<string, unknown>, key: string): string | null {
  return readPlanningString(record[key])
}

function readPlanningNumberField(record: Record<string, unknown>, key: string): number | null {
  return readPlanningNumber(record[key])
}

function readPlanningStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => readPlanningString(item))
    .filter((item): item is string => Boolean(item))
}

function readPlanningRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => readPlanningRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function readPlanningStyleGuide(value: unknown): PlanningStyleGuide {
  const record = readPlanningRecord(value) ?? {}
  return {
    visualTone: readPlanningStringField(record, 'visualTone'),
    cameraLanguage: readPlanningStringField(record, 'cameraLanguage'),
    editingLanguage: readPlanningStringField(record, 'editingLanguage'),
    colorAndLighting: readPlanningStringField(record, 'colorAndLighting'),
  }
}

export function styleGuideHasText(styleGuide: PlanningStyleGuide): boolean {
  return Boolean(
    styleGuide.visualTone
    || styleGuide.cameraLanguage
    || styleGuide.editingLanguage
    || styleGuide.colorAndLighting,
  )
}

function readPlanningEntity(value: unknown): PlanningEntity | null {
  const record = readPlanningRecord(value)
  if (!record) return null
  const name = readPlanningStringField(record, 'name')
  const summary = readPlanningStringField(record, 'summary')
  if (!name || !summary) return null
  return {
    id: readPlanningStringField(record, 'entityId') ?? name,
    name,
    aliases: readPlanningStringArray(record.aliases),
    summary,
  }
}

function readPlanningGlobalBible(value: unknown): PlanningGlobalBible | null {
  const record = readPlanningRecord(value)
  if (!record) return null
  const styleGuide = readPlanningStyleGuide(record.styleGuide)
  const globalBible: PlanningGlobalBible = {
    title: readPlanningStringField(record, 'title'),
    logline: readPlanningStringField(record, 'logline'),
    synopsis: readPlanningStringField(record, 'synopsis'),
    characters: readPlanningRecordArray(record.characters).map(readPlanningEntity).filter((item): item is PlanningEntity => Boolean(item)),
    locations: readPlanningRecordArray(record.locations).map(readPlanningEntity).filter((item): item is PlanningEntity => Boolean(item)),
    worldRules: readPlanningStringArray(record.worldRules),
    styleGuide,
  }
  if (
    !globalBible.title
    && !globalBible.logline
    && !globalBible.synopsis
    && globalBible.characters.length === 0
    && globalBible.locations.length === 0
    && globalBible.worldRules.length === 0
    && !styleGuideHasText(styleGuide)
  ) return null
  return globalBible
}

function readPlanningBeat(value: unknown): PlanningBeat | null {
  const record = readPlanningRecord(value)
  if (!record) return null
  const title = readPlanningStringField(record, 'title')
  const summary = readPlanningStringField(record, 'summary')
  if (!title || !summary) return null
  return {
    id: readPlanningStringField(record, 'beatId') ?? title,
    title,
    summary,
    durationSec: readPlanningNumberField(record, 'estimatedDurationSec'),
  }
}

function readPlanningBeats(value: unknown): readonly PlanningBeat[] {
  const record = readPlanningRecord(value)
  return readPlanningRecordArray(record?.beats).map(readPlanningBeat).filter((item): item is PlanningBeat => Boolean(item))
}

function readPlanningLedgerEntityRef(value: unknown): PlanningLedgerEntityRef | null {
  const record = readPlanningRecord(value)
  if (!record) return null
  const entityName = readPlanningStringField(record, 'entityName')
  if (!entityName) return null
  return {
    entityType: readPlanningStringField(record, 'entityType') ?? '',
    entityName,
  }
}

function readPlanningLedgerEvent(value: unknown): PlanningLedgerEvent | null {
  const record = readPlanningRecord(value)
  if (!record) return null
  const summary = readPlanningStringField(record, 'summary')
  if (!summary) return null
  return {
    id: readPlanningStringField(record, 'eventId') ?? summary,
    kind: readPlanningStringField(record, 'kind') ?? '',
    summary,
    entities: readPlanningRecordArray(record.entities)
      .map(readPlanningLedgerEntityRef)
      .filter((item): item is PlanningLedgerEntityRef => Boolean(item)),
    persistentFacts: readPlanningStringArray(record.persistentFacts),
  }
}

function readPlanningLedgerEvents(value: unknown): readonly PlanningLedgerEvent[] {
  const record = readPlanningRecord(value)
  return readPlanningRecordArray(record?.events).map(readPlanningLedgerEvent).filter((item): item is PlanningLedgerEvent => Boolean(item))
}

function readPlanningEmotionalCue(value: unknown): PlanningEmotionalCue | null {
  const record = readPlanningRecord(value)
  if (!record) return null
  const mood = readPlanningStringField(record, 'mood')
  if (!mood) return null
  return {
    id: readPlanningStringField(record, 'cueId') ?? mood,
    mood,
    intensity: readPlanningNumberField(record, 'intensity'),
    musicPolicy: readPlanningStringField(record, 'musicPolicy'),
    note: readPlanningStringField(record, 'note'),
  }
}

function readPlanningEmotionalCues(value: unknown): readonly PlanningEmotionalCue[] {
  const record = readPlanningRecord(value)
  return readPlanningRecordArray(record?.cues).map(readPlanningEmotionalCue).filter((item): item is PlanningEmotionalCue => Boolean(item))
}

export function readProductionPlanningDetails(details: WorkspaceCanvasEditBibleDetails): ProductionPlanningDetails {
  return {
    globalBible: readPlanningGlobalBible(details.bible),
    beats: readPlanningBeats(details.beatSheet),
    ledgerEvents: readPlanningLedgerEvents(details.ledger),
    emotionalCues: readPlanningEmotionalCues(details.emotionalCurve),
  }
}

export function hasProductionPlanningDetails(details: WorkspaceCanvasEditBibleDetails): boolean {
  const planning = readProductionPlanningDetails(details)
  return Boolean(
    planning.globalBible
    || planning.beats.length > 0
    || planning.ledgerEvents.length > 0
    || planning.emotionalCues.length > 0
    || details.chapters.length > 0,
  )
}
