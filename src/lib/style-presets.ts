export interface StylePresetOption {
  value: string
  label: string
  description: string
  enabled: boolean
}

const ALL_STYLE_PRESETS: readonly StylePresetOption[] = [
  {
    value: 'horror-suspense',
    label: '恐怖悬疑',
    description: '压迫氛围',
    enabled: false,
  },
]

export const STYLE_PRESETS: readonly StylePresetOption[] = ALL_STYLE_PRESETS.filter(
  (preset) => preset.enabled,
)

export const DEFAULT_STYLE_PRESET_VALUE = STYLE_PRESETS[0]?.value ?? ''

export function getStylePresetOption(value: string): StylePresetOption | null {
  return STYLE_PRESETS.find((preset) => preset.value === value) ?? STYLE_PRESETS[0] ?? null
}
