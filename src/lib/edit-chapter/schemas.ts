import { z } from 'zod'
import { AppError } from '@/lib/errors/app-error'
import { editScriptCoreSchema } from '@/lib/edit-script/types'
import { ledgerEventSchema, ledgerSnapshotSchema } from '@/lib/edit-ledger/schemas'
import { normalizeEditScriptStructure } from '@/lib/edit-script/normalize'
import { EDIT_CHARACTER_ROLES, EDIT_CHARACTER_VISIBILITIES, EDIT_SHOT_PURPOSES } from '@/lib/edit-script/types'

const assetMenuItemSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
}).strict()

export const chapterPlanAssetMenuSchema = z.object({
  locations: z.array(assetMenuItemSchema),
  characters: z.array(assetMenuItemSchema),
}).strict()

export const chapterPlanInputSchema = z.object({
  projectId: z.string().trim().min(1),
  episodeId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1),
  chapterIndex: z.number().int().min(0),
  bibleId: z.string().trim().min(1),
  bibleVersion: z.number().int().positive(),
  styleBibleChecksum: z.string().trim().min(1),
  sourceDocumentId: z.string().trim().min(1),
  sourceStart: z.number().int().min(0),
  sourceEnd: z.number().int().min(0),
  targetDurationSec: z.number().int().positive(),
  chapterTitle: z.string().trim().min(1).nullable(),
  chapterSummary: z.string().trim().min(1).nullable(),
  sourceText: z.string().trim().min(1),
  storyBibleJson: z.unknown(),
  styleBibleJson: z.unknown(),
  entrySnapshot: ledgerSnapshotSchema,
  events: z.array(ledgerEventSchema),
  assetMenu: chapterPlanAssetMenuSchema,
}).strict().superRefine((value, context) => {
  if (value.sourceEnd <= value.sourceStart) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceEnd'],
      message: 'sourceEnd must be greater than sourceStart.',
    })
  }
})

export const chapterPlanOutputSchema = editScriptCoreSchema.extend({
  persistentFactsIntroduced: z.array(z.string().trim().min(1)).max(200),
}).strict()

export type ChapterPlanInput = z.infer<typeof chapterPlanInputSchema>
export type ChapterPlanAssetMenu = z.infer<typeof chapterPlanAssetMenuSchema>
export type ChapterPlanOutput = z.infer<typeof chapterPlanOutputSchema>
export type NormalizedChapterPlanOutput = ReturnType<typeof normalizeEditScriptStructure> & {
  readonly persistentFactsIntroduced: readonly string[]
}

function nonEmptyEnum(values: readonly string[], label: string): [string, ...string[]] {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
  if (unique.length === 0) throw new Error(`CHAPTER_PLAN_ASSET_MENU_EMPTY:${label}`)
  return unique as [string, ...string[]]
}

export function buildChapterPlanOutputSchema(assetMenu: ChapterPlanAssetMenu) {
  const locationIds = nonEmptyEnum(assetMenu.locations.map((asset) => asset.id), 'location')
  const characterIds = nonEmptyEnum(assetMenu.characters.map((asset) => asset.id), 'character')
  const dynamicShotSchema = z.object({
    shotId: z.string().trim().min(1),
    shotNumber: z.number().int().positive(),
    shotPurpose: z.enum(EDIT_SHOT_PURPOSES),
    durationSec: z.number().int().min(1).max(5),
    scene: z.object({
      locationId: z.enum(locationIds),
      subScene: z.string().trim().min(1),
    }).strict(),
    action: z.string().trim().min(1),
    characters: z.array(z.object({
      characterId: z.enum(characterIds),
      visibility: z.enum(EDIT_CHARACTER_VISIBILITIES),
      role: z.enum(EDIT_CHARACTER_ROLES),
      performance: z.string().trim().min(1),
    }).strict()).min(0).max(20),
    keyObjects: z.array(z.object({
      name: z.string().trim().min(1),
      role: z.string().trim().min(1),
    }).strict()).min(0).max(20),
    sound: z.string().trim().min(1),
  }).strict()
  return z.object({
    shots: z.array(dynamicShotSchema).min(1).max(60),
    generationSegments: z.array(z.object({
      shotIds: z.array(z.string().trim().min(1)).min(1).max(9),
      continuity: z.string().trim().min(1),
    }).strict()).min(1).max(60),
    persistentFactsIntroduced: z.array(z.string().trim().min(1)).max(200),
  }).strict()
}

export function enrichChapterPlanOutputWithAssetNames(raw: unknown, assetMenu: ChapterPlanAssetMenu): ChapterPlanOutput {
  const parsed = buildChapterPlanOutputSchema(assetMenu).parse(raw)
  const locationById = new Map(assetMenu.locations.map((asset) => [asset.id, asset]))
  const characterById = new Map(assetMenu.characters.map((asset) => [asset.id, asset]))
  return {
    shots: parsed.shots.map((shot) => {
      const location = locationById.get(shot.scene.locationId)
      if (!location) {
        throw new AppError('PLAN_VALIDATION_FAILED', `PLAN_VALIDATION_FAILED:LOCATION_ID_UNKNOWN:${shot.scene.locationId}`, {
          details: {
            assetKind: 'location',
            assetId: shot.scene.locationId,
          },
        })
      }
      return {
        ...shot,
        scene: {
          locationId: shot.scene.locationId,
          name: location.name,
          subScene: shot.scene.subScene,
        },
        characters: shot.characters.map((character) => {
          const asset = characterById.get(character.characterId)
          if (!asset) {
            throw new AppError('PLAN_VALIDATION_FAILED', `PLAN_VALIDATION_FAILED:CHARACTER_ID_UNKNOWN:${character.characterId}`, {
              details: {
                assetKind: 'character',
                assetId: character.characterId,
              },
            })
          }
          return {
            ...character,
            name: asset.name,
          }
        }),
      }
    }),
    generationSegments: parsed.generationSegments,
    persistentFactsIntroduced: parsed.persistentFactsIntroduced,
  }
}

export function normalizeChapterPlanOutput(raw: unknown, assetMenu?: ChapterPlanAssetMenu): NormalizedChapterPlanOutput {
  const parsed = assetMenu
    ? enrichChapterPlanOutputWithAssetNames(raw, assetMenu)
    : chapterPlanOutputSchema.parse(raw)
  const normalizedCore = normalizeEditScriptStructure({
    shots: parsed.shots,
    generationSegments: parsed.generationSegments,
  })
  return {
    ...normalizedCore,
    shots: normalizedCore.shots,
    generationSegments: normalizedCore.generationSegments,
    persistentFactsIntroduced: parsed.persistentFactsIntroduced.map((fact) => fact.trim()),
  }
}
