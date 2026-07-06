import type { EditAssetKind } from '@/lib/edit-script/types'
import type { LedgerEvent, LedgerSnapshot } from '@/lib/edit-ledger'
import type { NormalizedChapterPlanOutput } from './schemas'

export interface ChapterPlanAssetRef {
  readonly kind: EditAssetKind
  readonly name: string
}

export interface ChapterPlanValidationInput {
  readonly chapterId: string
  readonly output: NormalizedChapterPlanOutput
  readonly entrySnapshot: LedgerSnapshot
  readonly events: readonly LedgerEvent[]
  readonly allowedAssets: readonly ChapterPlanAssetRef[]
  readonly referencedAssets: readonly ChapterPlanAssetRef[]
}

export interface ChapterPlanValidationResult {
  readonly ok: true
  readonly persistentFactsIntroduced: readonly string[]
}

function normalizeSemanticText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function semanticTokens(value: string): ReadonlySet<string> {
  const normalized = normalizeSemanticText(value)
  const tokens = new Set<string>()
  const words = normalized.match(/[a-z0-9]+|[\u3400-\u9fff\uf900-\ufaff]/g) ?? []
  words.forEach((word) => tokens.add(word))
  return tokens
}

function tokenOverlapRatio(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  left.forEach((token) => {
    if (right.has(token)) intersection += 1
  })
  return intersection / Math.min(left.size, right.size)
}

function isFactAllowedByLedger(fact: string, allowedFacts: ReadonlySet<string>): boolean {
  const normalizedFact = normalizeSemanticText(fact)
  if (allowedFacts.has(normalizedFact)) return true
  const factTokens = semanticTokens(normalizedFact)
  for (const allowedFact of allowedFacts) {
    if (
      normalizedFact.length >= 8
      && allowedFact.length >= 8
      && (normalizedFact.includes(allowedFact) || allowedFact.includes(normalizedFact))
    ) {
      return true
    }
    if (tokenOverlapRatio(factTokens, semanticTokens(allowedFact)) >= 0.8) {
      return true
    }
  }
  return false
}

function assetKey(asset: ChapterPlanAssetRef): string {
  return `${asset.kind}:${normalizeSemanticText(asset.name)}`
}

function buildAllowedFactSet(input: {
  readonly entrySnapshot: LedgerSnapshot
  readonly events: readonly LedgerEvent[]
}): ReadonlySet<string> {
  const facts = new Set<string>()
  input.entrySnapshot.facts.forEach((fact) => facts.add(normalizeSemanticText(fact)))
  input.events.forEach((event) => {
    event.persistentFacts.forEach((fact) => facts.add(normalizeSemanticText(fact)))
  })
  return facts
}

function buildAllowedAssetSet(assets: readonly ChapterPlanAssetRef[]): ReadonlySet<string> {
  return new Set(assets.map(assetKey))
}

export function validateChapterPlan(input: ChapterPlanValidationInput): ChapterPlanValidationResult {
  const allowedFacts = buildAllowedFactSet({
    entrySnapshot: input.entrySnapshot,
    events: input.events,
  })
  const unknownFacts = input.output.persistentFactsIntroduced.filter((fact) => !isFactAllowedByLedger(fact, allowedFacts))
  if (unknownFacts.length > 0) {
    throw new Error(`PLAN_VALIDATION_FAILED:PERSISTENT_FACT_UNKNOWN:${input.chapterId}:${unknownFacts.join('|')}`)
  }

  const allowedAssets = buildAllowedAssetSet(input.allowedAssets)
  const unknownAssets = input.referencedAssets.filter((asset) => !allowedAssets.has(assetKey(asset)))
  if (unknownAssets.length > 0) {
    throw new Error(`PLAN_VALIDATION_FAILED:ASSET_UNKNOWN:${input.chapterId}:${unknownAssets.map(assetKey).join('|')}`)
  }

  return {
    ok: true,
    persistentFactsIntroduced: input.output.persistentFactsIntroduced,
  }
}
