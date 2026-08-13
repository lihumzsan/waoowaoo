import type { CapabilityFieldI18n, CapabilityValue, ModelCapabilities, VideoCapabilities } from '@/lib/ai-registry/types'
import { isCapabilityValue, isPlainObject } from './catalog-utils'

// -----------------------------
// Video model helpers
// -----------------------------

export interface VideoModelCapabilityCarrier {
  capabilities?: ModelCapabilities
}

function readGenerationModeOptions(model: VideoModelCapabilityCarrier): string[] {
  const options = model.capabilities?.video?.generationModeOptions
  if (!Array.isArray(options)) return []
  return options.filter((value): value is string => typeof value === 'string')
}

export function supportsFirstLastFrame(model: VideoModelCapabilityCarrier): boolean {
  return model.capabilities?.video?.firstlastframe === true
}

export function isFirstLastFrameOnlyModel(model: VideoModelCapabilityCarrier): boolean {
  const generationModeOptions = readGenerationModeOptions(model)
  if (generationModeOptions.length === 0) return false
  return generationModeOptions.every((mode) => mode === 'firstlastframe')
}

export function filterNormalVideoModelOptions<T extends VideoModelCapabilityCarrier>(models: T[]): T[] {
  return models.filter((model) => !isFirstLastFrameOnlyModel(model))
}

export interface EffectiveVideoCapabilityDefinition {
  field: string
  options: CapabilityValue[]
  fieldI18n: CapabilityFieldI18n | null
}

export interface EffectiveVideoCapabilityField extends EffectiveVideoCapabilityDefinition {
  value: CapabilityValue | undefined
}

function parseVideoFieldI18n(raw: unknown): CapabilityFieldI18n | null {
  if (!isPlainObject(raw)) return null
  const labelKey = typeof Reflect.get(raw, 'labelKey') === 'string' && String(Reflect.get(raw, 'labelKey')).trim()
    ? String(Reflect.get(raw, 'labelKey')).trim()
    : undefined
  const unitKey = typeof Reflect.get(raw, 'unitKey') === 'string' && String(Reflect.get(raw, 'unitKey')).trim()
    ? String(Reflect.get(raw, 'unitKey')).trim()
    : undefined

  const optionLabelKeysRaw = Reflect.get(raw, 'optionLabelKeys')
  const optionLabelKeys = isPlainObject(optionLabelKeysRaw)
    ? Object.entries(optionLabelKeysRaw).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        acc[key] = value.trim()
      }
      return acc
    }, {})
    : undefined

  return {
    ...(labelKey ? { labelKey } : {}),
    ...(unitKey ? { unitKey } : {}),
    ...(optionLabelKeys && Object.keys(optionLabelKeys).length > 0 ? { optionLabelKeys } : {}),
  }
}

function collectVideoFieldI18nMap(
  videoCapabilities: VideoCapabilities | undefined,
): Record<string, CapabilityFieldI18n | null> {
  const map: Record<string, CapabilityFieldI18n | null> = {}
  const rawMap = isPlainObject(videoCapabilities?.fieldI18n) ? videoCapabilities.fieldI18n : undefined
  if (!rawMap || !isPlainObject(rawMap)) return map
  for (const [field, raw] of Object.entries(rawMap)) {
    map[field] = parseVideoFieldI18n(raw)
  }
  return map
}

function isCapabilityValueArray(value: unknown): value is CapabilityValue[] {
  return Array.isArray(value) && value.every((item) => isCapabilityValue(item))
}

function buildVideoDefinitionsFromCapabilities(
  videoCapabilities: VideoCapabilities | undefined,
  fieldI18nMap: Record<string, CapabilityFieldI18n | null>,
): EffectiveVideoCapabilityDefinition[] {
  if (!isPlainObject(videoCapabilities)) return []
  const definitions: EffectiveVideoCapabilityDefinition[] = []

  for (const [key, rawValue] of Object.entries(videoCapabilities)) {
    if (!key.endsWith('Options')) continue
    if (!isCapabilityValueArray(rawValue) || rawValue.length === 0) continue
    const field = key.slice(0, -'Options'.length)
    definitions.push({
      field,
      options: rawValue,
      fieldI18n: fieldI18nMap[field] || null,
    })
  }

  return definitions
}

function getCompatibleOptionsForField(input: {
  options: CapabilityValue[]
}): CapabilityValue[] {
  return input.options.slice()
}

function filterSelectionByDefinitions(
  definitions: EffectiveVideoCapabilityDefinition[],
  selection: Record<string, CapabilityValue> | undefined,
): Record<string, CapabilityValue> {
  if (!selection) return {}
  const fields = new Set(definitions.map((definition) => definition.field))
  const next: Record<string, CapabilityValue> = {}
  for (const [field, value] of Object.entries(selection)) {
    if (!fields.has(field)) continue
    if (!isCapabilityValue(value)) continue
    next[field] = value
  }
  return next
}

export function resolveEffectiveVideoCapabilityDefinitions(input: {
  videoCapabilities?: VideoCapabilities
}): EffectiveVideoCapabilityDefinition[] {
  const fieldI18nMap = collectVideoFieldI18nMap(input.videoCapabilities)
  return buildVideoDefinitionsFromCapabilities(input.videoCapabilities, fieldI18nMap)
}

export function normalizeVideoGenerationSelections(input: {
  definitions: EffectiveVideoCapabilityDefinition[]
  selection?: Record<string, CapabilityValue>
  pinnedFields?: string[]
}): Record<string, CapabilityValue> {
  const normalized = filterSelectionByDefinitions(input.definitions, input.selection)
  const pinnedFieldSet = new Set(input.pinnedFields || [])
  const orderedDefinitions = input.definitions.slice().sort((left, right) => {
    const leftPinned = pinnedFieldSet.has(left.field)
    const rightPinned = pinnedFieldSet.has(right.field)
    if (leftPinned === rightPinned) return 0
    return leftPinned ? 1 : -1
  })

  if (input.definitions.length === 0) return {}

  let changed = true
  let attempts = 0
  const maxAttempts = Math.max(4, input.definitions.length * 3)
  while (changed && attempts < maxAttempts) {
    attempts += 1
    changed = false

    for (const definition of orderedDefinitions) {
      const compatibleOptions = getCompatibleOptionsForField({
        options: definition.options,
      })

      const current = normalized[definition.field]
      if (compatibleOptions.length === 0) {
        if (current !== undefined) {
          delete normalized[definition.field]
          changed = true
        }
        continue
      }

      if (current === undefined || !compatibleOptions.includes(current)) {
        normalized[definition.field] = compatibleOptions[0]
        changed = true
      }
    }
  }

  return normalized
}

export function resolveEffectiveVideoCapabilityFields(input: {
  definitions: EffectiveVideoCapabilityDefinition[]
  selection?: Record<string, CapabilityValue>
}): EffectiveVideoCapabilityField[] {
  const normalized = normalizeVideoGenerationSelections({
    definitions: input.definitions,
    selection: input.selection,
  })

  return input.definitions.map((definition) => {
    const options = getCompatibleOptionsForField({
      options: definition.options,
    })
    const value = normalized[definition.field]
    return {
      ...definition,
      options,
      value: value !== undefined && options.includes(value) ? value : undefined,
    }
  })
}
