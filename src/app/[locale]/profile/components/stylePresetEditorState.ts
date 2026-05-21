import type {
  StylePresetKind,
  StylePresetView,
  VisualStyleConfig,
} from '@/lib/style-preset/types'
import { buildPromptOnlyVisualStyleConfig } from '@/lib/style-preset/visual-config'

export type DraftState = {
  id: string | null
  kind: StylePresetKind
  name: string
  summary: string
  instruction: string
  config: VisualStyleConfig
}

const EMPTY_VISUAL_STYLE_CONFIG: VisualStyleConfig = buildPromptOnlyVisualStyleConfig('')

export function buildDraft(kind: StylePresetKind = 'visual_style'): DraftState {
  return {
    id: null,
    kind,
    name: '',
    summary: '',
    instruction: '',
    config: { ...EMPTY_VISUAL_STYLE_CONFIG },
  }
}

export function readPresetList(value: unknown): StylePresetView[] {
  if (!value || typeof value !== 'object') return []
  const presets = (value as { presets?: unknown }).presets
  if (!Array.isArray(presets)) return []
  return presets.filter((preset): preset is StylePresetView => {
    if (!preset || typeof preset !== 'object') return false
    const record = preset as { id?: unknown; kind?: unknown; name?: unknown; config?: unknown }
    return typeof record.id === 'string'
      && record.kind === 'visual_style'
      && typeof record.name === 'string'
      && Boolean(record.config)
  })
}

export function readDesignedPreset(value: unknown): Omit<DraftState, 'id' | 'instruction'> | null {
  if (!value || typeof value !== 'object') return null
  const record = value as {
    kind?: unknown
    name?: unknown
    summary?: unknown
    config?: unknown
  }
  if (record.kind !== 'visual_style') return null
  if (typeof record.name !== 'string') return null
  return {
    kind: record.kind,
    name: record.name,
    summary: typeof record.summary === 'string' ? record.summary : '',
    config: record.config as VisualStyleConfig,
  }
}
