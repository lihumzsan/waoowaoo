import { ART_STYLES, getArtStylePrompt } from '@/lib/constants'
import type { VisualStyleConfig } from './types'

export function isSystemVisualStylePresetId(value: string): boolean {
  return ART_STYLES.some((style) => style.value === value)
}

export function listSystemVisualStylePresets(locale: 'zh' | 'en') {
  return ART_STYLES.map((style) => ({
    presetSource: 'system' as const,
    presetId: style.value,
    label: style.label,
    description: getArtStylePrompt(style.value, locale),
  }))
}

export function buildSystemVisualStyleConfig(presetId: string, locale: 'zh' | 'en'): VisualStyleConfig {
  const style = ART_STYLES.find((item) => item.value === presetId)
  if (!style) {
    throw new Error(`VISUAL_STYLE_SYSTEM_PRESET_UNSUPPORTED:${presetId}`)
  }
  return {
    prompt: getArtStylePrompt(presetId, locale),
    negativePrompt: '',
    colorPalette: [],
    lineStyle: '',
    texture: '',
    lighting: '',
    composition: '',
    detailLevel: 'medium',
  }
}
