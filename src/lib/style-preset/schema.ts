import { z } from 'zod'
import {
  PRESET_SOURCES,
  STYLE_PRESET_KINDS,
  type PresetSource,
  type StylePresetKind,
  type StylePresetRef,
  type VisualStyleConfig,
} from './types'

const nonEmptyStringSchema = z.string().transform((value) => value.trim()).pipe(z.string().min(1))

export const presetSourceSchema = z.enum(PRESET_SOURCES)
export const stylePresetKindSchema = z.enum(STYLE_PRESET_KINDS)

export const stylePresetRefSchema = z.object({
  presetSource: presetSourceSchema,
  presetId: nonEmptyStringSchema,
})

export const visualStyleConfigSchema = z.object({
  prompt: nonEmptyStringSchema,
  negativePrompt: z.string(),
  colorPalette: z.array(z.string()),
  lineStyle: z.string(),
  texture: z.string(),
  lighting: z.string(),
  composition: z.string(),
  detailLevel: z.enum(['low', 'medium', 'high']),
})

export function isPresetSource(value: unknown): value is PresetSource {
  return presetSourceSchema.safeParse(value).success
}

export function isStylePresetKind(value: unknown): value is StylePresetKind {
  return stylePresetKindSchema.safeParse(value).success
}

export function parseStylePresetRef(value: unknown): StylePresetRef {
  return stylePresetRefSchema.parse(value)
}

export function parseVisualStyleConfig(value: unknown): VisualStyleConfig {
  return visualStyleConfigSchema.parse(value)
}

export function parseStylePresetConfig(_kind: StylePresetKind, value: unknown): VisualStyleConfig {
  return parseVisualStyleConfig(value)
}

export function parseStoredStylePresetConfig(kind: StylePresetKind, raw: string): VisualStyleConfig {
  const parsed = JSON.parse(raw) as unknown
  return parseStylePresetConfig(kind, parsed)
}
