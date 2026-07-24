import { createHash } from 'node:crypto'
import { z } from 'zod'

export const ASSET_MANIFEST_KINDS = ['character', 'location', 'prop'] as const
export type AssetManifestKind = typeof ASSET_MANIFEST_KINDS[number]

const canonicalName = z.string().trim().min(1).max(300)
const textList = (maxItems: number, maxLength: number) => z.array(
  z.string().trim().min(1).max(maxLength),
).max(maxItems)

export const screenplayWorkerOutputSchema = z.object({
  kind: z.literal('screenplay'),
  title: canonicalName,
  logline: z.string().max(2_000).nullable(),
  synopsis: z.string().max(12_000),
  screenplayText: z.string().min(1).max(200_000),
  source: z.object({
    kind: z.enum(['generated', 'provided', 'revised']),
    label: z.string().trim().min(1).max(500),
  }).strict(),
  assumptions: textList(64, 2_000),
  openQuestions: textList(64, 2_000),
}).strict()

export const screenplaySchema = screenplayWorkerOutputSchema

const sourceRefSchema = z.object({
  sourceExcerpt: z.string().trim().min(1).max(4_000),
  reason: z.string().trim().min(1).max(2_000),
}).strict()

const assetManifestItemWorkerSchema = z.object({
  kind: z.enum(ASSET_MANIFEST_KINDS),
  canonicalName,
  aliases: textList(64, 300),
  sourceRefs: z.array(sourceRefSchema).min(1).max(128)
    .describe('Exact excerpts from the supplied screenplay that justify producing this reusable visual asset.'),
  stableDescription: z.string().min(1).max(16_000)
    .describe('Stable visible identity and structure only; exclude transient action and project visual-style wording.'),
  generationPrompt: z.string().min(1).max(24_000)
    .describe('Final asset image prompt using the exact supplied Creative Direction and the grounded asset facts.'),
  negativePrompt: z.string().max(8_000).nullable(),
  referenceRequirements: textList(64, 2_000),
  continuityRequirements: textList(64, 2_000),
}).strict()

export const assetManifestWorkerOutputSchema = z.object({
  kind: z.literal('asset_manifest'),
  overview: z.string().min(1).max(8_000),
  assets: z.array(assetManifestItemWorkerSchema).max(1_024),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

const assetManifestItemSchema = assetManifestItemWorkerSchema.extend({
  manifestAssetId: z.string().trim().min(1).max(80),
}).strict()

export const assetManifestSchema = assetManifestWorkerOutputSchema.extend({
  assets: z.array(assetManifestItemSchema).max(1_024),
}).strict()

export type Screenplay = z.infer<typeof screenplaySchema>
export type ScreenplayWorkerOutput = z.infer<typeof screenplayWorkerOutputSchema>
export type AssetManifest = z.infer<typeof assetManifestSchema>

function normalizedIdentity(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function stableManifestAssetId(kind: AssetManifestKind, value: string): string {
  const prefix = kind === 'character' ? 'ASSET_CHAR' : kind === 'location' ? 'ASSET_LOC' : 'ASSET_PROP'
  const digest = createHash('sha256')
    .update(`${kind}\0${normalizedIdentity(value)}`)
    .digest('hex')
    .slice(0, 16)
  return `${prefix}_${digest.toUpperCase()}`
}

function validateManifestIdentity(
  assets: readonly z.infer<typeof assetManifestItemSchema>[],
): void {
  const identitiesByKind = new Map<AssetManifestKind, Map<string, string>>()
  const ids = new Set<string>()
  for (const asset of assets) {
    const expectedId = stableManifestAssetId(asset.kind, asset.canonicalName)
    if (asset.manifestAssetId !== expectedId) {
      throw new Error(`ASSET_MANIFEST_ID_INVALID:${asset.manifestAssetId}`)
    }
    if (ids.has(asset.manifestAssetId)) {
      throw new Error(`ASSET_MANIFEST_ID_DUPLICATE:${asset.manifestAssetId}`)
    }
    ids.add(asset.manifestAssetId)
    const names = identitiesByKind.get(asset.kind) ?? new Map<string, string>()
    identitiesByKind.set(asset.kind, names)
    for (const candidate of [asset.canonicalName, ...asset.aliases]) {
      const normalized = normalizedIdentity(candidate)
      const existing = names.get(normalized)
      if (existing && existing !== asset.manifestAssetId) {
        throw new Error(`ASSET_MANIFEST_NAME_AMBIGUOUS:${asset.kind}:${candidate}`)
      }
      names.set(normalized, asset.manifestAssetId)
    }
  }
}

function validateSourceRefs(input: {
  readonly screenplay: Screenplay
  readonly manifest: AssetManifest
}): void {
  for (const asset of input.manifest.assets) {
    const ranges = new Set<string>()
    for (const sourceRef of asset.sourceRefs) {
      if (!input.screenplay.screenplayText.includes(sourceRef.sourceExcerpt)) {
        throw new Error(`ASSET_MANIFEST_SOURCE_REF_INVALID:${asset.manifestAssetId}`)
      }
      if (ranges.has(sourceRef.sourceExcerpt)) {
        throw new Error(`ASSET_MANIFEST_SOURCE_REF_DUPLICATE:${asset.manifestAssetId}`)
      }
      ranges.add(sourceRef.sourceExcerpt)
    }
  }
}

export function validateAssetManifest(input: {
  readonly screenplay: Screenplay
  readonly manifest: unknown
}): AssetManifest {
  const manifest = assetManifestSchema.parse(input.manifest)
  validateManifestIdentity(manifest.assets)
  validateSourceRefs({ screenplay: input.screenplay, manifest })
  return manifest
}

export function compileAssetManifest(input: {
  readonly screenplay: Screenplay
  readonly manifest: unknown
}): AssetManifest {
  const workerManifest = assetManifestWorkerOutputSchema.parse(input.manifest)
  const manifest = assetManifestSchema.parse({
    ...workerManifest,
    assets: workerManifest.assets.map((asset) => ({
      ...asset,
      manifestAssetId: stableManifestAssetId(asset.kind, asset.canonicalName),
    })),
  })
  return validateAssetManifest({ screenplay: input.screenplay, manifest })
}
