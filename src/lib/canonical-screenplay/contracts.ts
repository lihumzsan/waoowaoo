import { createHash } from 'node:crypto'
import { z } from 'zod'

export const CANONICAL_ENTITY_KINDS = ['character', 'location', 'prop'] as const
export type CanonicalEntityKind = typeof CANONICAL_ENTITY_KINDS[number]

const canonicalName = z.string().trim().min(1).max(300)
const textList = (maxItems: number, maxLength: number) => z.array(
  z.string().trim().min(1).max(maxLength),
).max(maxItems)

const workerEntitySchema = z.object({
  canonicalName,
  aliases: textList(64, 300),
  description: z.string().max(8_000),
}).strict()

const workerSceneSchema = z.object({
  order: z.number().int().positive(),
  heading: z.string().trim().min(1).max(500),
  summary: z.string().max(4_000),
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().positive(),
  locationCanonicalName: canonicalName,
  characterCanonicalNames: textList(128, 300),
  propCanonicalNames: textList(128, 300),
}).strict()

export const canonicalScreenplayWorkerOutputSchema = z.object({
  kind: z.literal('canonical_screenplay'),
  title: canonicalName,
  logline: z.string().max(2_000).nullable(),
  synopsis: z.string().max(12_000),
  screenplayText: z.string().min(1).max(200_000),
  estimatedDurationSeconds: z.number().finite().nonnegative().nullable(),
  source: z.object({
    kind: z.enum(['generated', 'provided', 'revised']),
    label: z.string().trim().min(1).max(500),
  }).strict(),
  entities: z.object({
    characters: z.array(workerEntitySchema).max(256),
    locations: z.array(workerEntitySchema).min(1).max(256),
    props: z.array(workerEntitySchema).max(512),
  }).strict(),
  scenes: z.array(workerSceneSchema).min(1).max(1_024),
  assumptions: textList(64, 2_000),
  openQuestions: textList(64, 2_000),
}).strict()

const canonicalEntitySchema = workerEntitySchema.extend({
  entityId: z.string().trim().min(1).max(80),
  kind: z.enum(CANONICAL_ENTITY_KINDS),
}).strict()

const canonicalSceneSchema = z.object({
  sceneId: z.string().trim().min(1).max(80),
  order: z.number().int().positive(),
  heading: z.string().trim().min(1).max(500),
  summary: z.string().max(4_000),
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().positive(),
  locationId: z.string().trim().min(1).max(80),
  characterIds: z.array(z.string().trim().min(1).max(80)).max(128),
  propIds: z.array(z.string().trim().min(1).max(80)).max(128),
}).strict()

export const canonicalScreenplaySchema = z.object({
  kind: z.literal('canonical_screenplay'),
  title: canonicalName,
  logline: z.string().max(2_000).nullable(),
  synopsis: z.string().max(12_000),
  screenplayText: z.string().min(1).max(200_000),
  estimatedDurationSeconds: z.number().finite().nonnegative().nullable(),
  source: canonicalScreenplayWorkerOutputSchema.shape.source,
  entities: z.object({
    characters: z.array(canonicalEntitySchema.extend({ kind: z.literal('character') }).strict()).max(256),
    locations: z.array(canonicalEntitySchema.extend({ kind: z.literal('location') }).strict()).min(1).max(256),
    props: z.array(canonicalEntitySchema.extend({ kind: z.literal('prop') }).strict()).max(512),
  }).strict(),
  scenes: z.array(canonicalSceneSchema).min(1).max(1_024),
  assumptions: textList(64, 2_000),
  openQuestions: textList(64, 2_000),
}).strict()

const canonicalEntityReferenceSchema = z.object({
  entityId: z.string().trim().min(1).max(80),
  kind: z.enum(CANONICAL_ENTITY_KINDS),
}).strict()

export const assetManifestWorkerOutputSchema = z.object({
  kind: z.literal('asset_manifest'),
  overview: z.string().max(8_000),
  assets: z.array(z.object({
    canonicalEntity: canonicalEntityReferenceSchema,
    title: canonicalName,
    stableDescription: z.string().min(1).max(16_000)
      .describe('Stable visible identity and structure only; exclude transient action and project visual-style wording.'),
    generationPrompt: z.string().min(1).max(24_000)
      .describe('Final asset image prompt using the exact supplied Style Bible and the canonical entity facts.'),
    negativePrompt: z.string().max(8_000).nullable(),
    referenceRequirements: textList(64, 2_000),
    continuityRequirements: textList(64, 2_000),
  }).strict()).min(1).max(1_024),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

export const assetManifestSchema = assetManifestWorkerOutputSchema

export type CanonicalScreenplayWorkerOutput = z.infer<typeof canonicalScreenplayWorkerOutputSchema>
export type CanonicalScreenplay = z.infer<typeof canonicalScreenplaySchema>
export type AssetManifest = z.infer<typeof assetManifestSchema>

function normalizedIdentity(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function stableId(prefix: string, value: string): string {
  const digest = createHash('sha256').update(`${prefix}\0${normalizedIdentity(value)}`).digest('hex').slice(0, 16)
  return `${prefix}_${digest.toUpperCase()}`
}

function uniqueNames(values: readonly string[], code: string): void {
  const names = new Set<string>()
  for (const value of values) {
    const normalized = normalizedIdentity(value)
    if (names.has(normalized)) throw new Error(`${code}:${value}`)
    names.add(normalized)
  }
}

function entityMap<T extends CanonicalEntityKind>(
  kind: T,
  entities: readonly z.infer<typeof workerEntitySchema>[],
) {
  uniqueNames(entities.map((entity) => entity.canonicalName), 'CANONICAL_SCREENPLAY_ENTITY_NAME_DUPLICATE')
  const byName = new Map<string, string>()
  const compiled = entities.map((entity) => {
    const entityId = stableId(kind === 'character' ? 'CHAR' : kind === 'location' ? 'LOC' : 'PROP', entity.canonicalName)
    for (const name of [entity.canonicalName, ...entity.aliases]) {
      const normalized = normalizedIdentity(name)
      const existing = byName.get(normalized)
      if (existing && existing !== entityId) {
        throw new Error(`CANONICAL_SCREENPLAY_ENTITY_ALIAS_AMBIGUOUS:${name}`)
      }
      byName.set(normalized, entityId)
    }
    return { ...entity, entityId, kind }
  })
  return { compiled, byName }
}

function resolveEntityIds(
  names: readonly string[],
  byName: ReadonlyMap<string, string>,
  code: string,
): string[] {
  uniqueNames(names, `${code}_DUPLICATE`)
  return names.map((name) => {
    const entityId = byName.get(normalizedIdentity(name))
    if (!entityId) throw new Error(`${code}:${name}`)
    return entityId
  })
}

export function compileCanonicalScreenplay(raw: unknown): CanonicalScreenplay {
  const input = canonicalScreenplayWorkerOutputSchema.parse(raw)
  const characters = entityMap('character', input.entities.characters)
  const locations = entityMap('location', input.entities.locations)
  const props = entityMap('prop', input.entities.props)
  let previousEnd = 0
  const scenes = input.scenes.map((scene, index) => {
    if (scene.order !== index + 1) throw new Error(`CANONICAL_SCREENPLAY_SCENE_ORDER_INVALID:${String(scene.order)}`)
    if (
      scene.sourceStart < previousEnd
      || scene.sourceEnd <= scene.sourceStart
      || scene.sourceEnd > input.screenplayText.length
      || !input.screenplayText.slice(scene.sourceStart, scene.sourceEnd).trim()
    ) {
      throw new Error(`CANONICAL_SCREENPLAY_SCENE_RANGE_INVALID:${String(scene.order)}`)
    }
    previousEnd = scene.sourceEnd
    const locationId = locations.byName.get(normalizedIdentity(scene.locationCanonicalName))
    if (!locationId) {
      throw new Error(`CANONICAL_SCREENPLAY_SCENE_LOCATION_UNKNOWN:${scene.locationCanonicalName}`)
    }
    return {
      sceneId: `SCENE_${String(scene.order).padStart(4, '0')}`,
      order: scene.order,
      heading: scene.heading,
      summary: scene.summary,
      sourceStart: scene.sourceStart,
      sourceEnd: scene.sourceEnd,
      locationId,
      characterIds: resolveEntityIds(
        scene.characterCanonicalNames,
        characters.byName,
        'CANONICAL_SCREENPLAY_SCENE_CHARACTER_UNKNOWN',
      ),
      propIds: resolveEntityIds(
        scene.propCanonicalNames,
        props.byName,
        'CANONICAL_SCREENPLAY_SCENE_PROP_UNKNOWN',
      ),
    }
  })
  return canonicalScreenplaySchema.parse({
    ...input,
    entities: {
      characters: characters.compiled,
      locations: locations.compiled,
      props: props.compiled,
    },
    scenes,
  })
}

export function validateAssetManifestCoverage(input: {
  readonly screenplay: CanonicalScreenplay
  readonly manifest: unknown
}): AssetManifest {
  const manifest = assetManifestSchema.parse(input.manifest)
  const expected = [
    ...input.screenplay.entities.characters,
    ...input.screenplay.entities.locations,
    ...input.screenplay.entities.props,
  ]
  const expectedById = new Map(expected.map((entity) => [entity.entityId, entity.kind]))
  const seen = new Set<string>()
  for (const asset of manifest.assets) {
    const { entityId, kind } = asset.canonicalEntity
    const expectedKind = expectedById.get(entityId)
    if (!expectedKind || expectedKind !== kind) {
      throw new Error(`ASSET_MANIFEST_CANONICAL_ENTITY_INVALID:${entityId}`)
    }
    if (seen.has(entityId)) throw new Error(`ASSET_MANIFEST_CANONICAL_ENTITY_DUPLICATE:${entityId}`)
    seen.add(entityId)
  }
  if (seen.size !== expectedById.size) {
    const missing = [...expectedById.keys()].filter((entityId) => !seen.has(entityId))
    throw new Error(`ASSET_MANIFEST_CANONICAL_ENTITY_MISSING:${missing.join(',')}`)
  }
  return manifest
}
