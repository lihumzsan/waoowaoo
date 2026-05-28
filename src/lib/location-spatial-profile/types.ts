import { z } from 'zod'

export const LOCATION_SPATIAL_PROFILE_SCHEMA_VERSION = 1

export const LOCATION_SPATIAL_PROFILE_STATUSES = [
  'pending',
  'analyzing',
  'ready',
  'failed',
  'stale',
] as const

export type LocationSpatialProfileStatus = (typeof LOCATION_SPATIAL_PROFILE_STATUSES)[number]

const FORBIDDEN_FIELD_NAMES = new Set([
  'x',
  'y',
  'blockedZones',
  'cameraVantages',
  'profileSource',
  'placementZones',
  'availableSlots',
  'available_slots',
])
const COORDINATE_PATTERN = /\b(?:x|y)\s*[:=]\s*-?\d+(?:\.\d+)?\b|坐标|coordinate|coordinates/i

function assertNoForbiddenSpatialFields(value: unknown, path: readonly string[], ctx: z.RefinementCtx): void {
  if (typeof value === 'string') {
    if (COORDINATE_PATTERN.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'LOCATION_SPATIAL_PROFILE_COORDINATES_FORBIDDEN',
        path: [...path],
      })
    }
    return
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenSpatialFields(item, [...path, String(index)], ctx))
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `LOCATION_SPATIAL_PROFILE_FORBIDDEN_FIELD:${key}`,
        path: [...path, key],
      })
    }
    if (typeof child === 'string' && COORDINATE_PATTERN.test(child)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'LOCATION_SPATIAL_PROFILE_COORDINATES_FORBIDDEN',
        path: [...path, key],
      })
    }
    assertNoForbiddenSpatialFields(child, [...path, key], ctx)
  }
}

const anchorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  screenArea: z.string().min(1),
  depthLayer: z.string().min(1),
  spatialRelations: z.array(z.string().min(1)).min(1),
}).strict()

export const locationSpatialProfileSchema = z.object({
  schemaVersion: z.literal(LOCATION_SPATIAL_PROFILE_SCHEMA_VERSION),
  sceneSummary: z.string().min(1),
  anchors: z.array(anchorSchema).min(1),
  depthLayout: z.object({
    foreground: z.string().min(1),
    midground: z.string().min(1),
    background: z.string().min(1),
  }).strict(),
  lightingDirection: z.string().min(1),
}).strict().superRefine((value, ctx) => {
  assertNoForbiddenSpatialFields(value, [], ctx)
})

export type LocationSpatialProfile = z.infer<typeof locationSpatialProfileSchema>

export function parseLocationSpatialProfile(value: unknown): LocationSpatialProfile {
  return locationSpatialProfileSchema.parse(value)
}

export function formatLocationSpatialProfileForPrompt(profile: LocationSpatialProfile): string {
  const anchors = profile.anchors
    .map((anchor) => `- ${anchor.label}：${anchor.screenArea}，${anchor.depthLayer}；${anchor.spatialRelations.join('；')}`)
    .join('\n')
  return [
    `场景空间总结：${profile.sceneSummary}`,
    '空间锚点：',
    anchors,
    `景深布局：前景：${profile.depthLayout.foreground}；中景：${profile.depthLayout.midground}；背景：${profile.depthLayout.background}`,
    `光线方向：${profile.lightingDirection}`,
  ].join('\n')
}
