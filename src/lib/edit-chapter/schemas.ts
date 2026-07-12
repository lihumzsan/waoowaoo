import { z } from 'zod'
import { AppError } from '@/lib/errors/app-error'
import {
  EDIT_CHARACTER_ROLES,
  EDIT_CHARACTER_VISIBILITIES,
  EDIT_SHOT_PURPOSES,
  editScriptCoreSchema,
  editScriptPerformanceSchema,
} from '@/lib/edit-script/types'
import { ledgerEventSchema, ledgerSnapshotSchema } from '@/lib/edit-ledger/schemas'
import { normalizeEditScriptStructure } from '@/lib/edit-script/normalize'

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

export const chapterPlanOutputSchema = editScriptCoreSchema.strict()

export const chapterPlanRawShotSchema = z.object({
  shotRef: z.string().trim().min(1),
  shotNumber: z.number().int().positive(),
  shotPurpose: z.enum(EDIT_SHOT_PURPOSES),
  durationSec: z.number().int().min(1).max(5),
  scene: z.object({
    locationName: z.string().trim().min(1),
    subScene: z.string().trim().min(1),
  }).strict(),
  action: z.string().trim().min(1),
  characters: z.array(z.object({
    characterName: z.string().trim().min(1),
    visibility: z.enum(EDIT_CHARACTER_VISIBILITIES),
    role: z.enum(EDIT_CHARACTER_ROLES),
    performance: editScriptPerformanceSchema,
  }).strict()).min(0).max(20),
  keyObjects: z.array(z.object({
    name: z.string().trim().min(1),
    role: z.string().trim().min(1),
  }).strict()).min(0).max(20),
  dialogue: z.array(z.object({
    speakerName: z.string().trim().min(1),
    line: z.string().trim().min(1),
  }).strict()).min(0).max(20),
  sound: z.string().trim().min(1),
}).strict()

export const chapterPlanRawGenerationSegmentSchema = z.object({
  shotRefs: z.array(z.string().trim().min(1)).min(1).max(9),
  continuity: z.string().trim().min(1),
}).strict()

export const chapterPlanRawOutputSchema = z.object({
  shots: z.array(chapterPlanRawShotSchema).min(1).max(60),
  generationSegments: z.array(chapterPlanRawGenerationSegmentSchema).min(1).max(60),
}).strict()

export type ChapterPlanInput = z.infer<typeof chapterPlanInputSchema>
export type ChapterPlanAssetMenu = z.infer<typeof chapterPlanAssetMenuSchema>
export type ChapterPlanOutput = z.infer<typeof chapterPlanOutputSchema>
export type ChapterPlanRawShot = z.infer<typeof chapterPlanRawShotSchema>
export type NormalizedChapterPlanOutput = ReturnType<typeof normalizeEditScriptStructure>

function nonEmptyEnum(values: readonly string[], label: string): [string, ...string[]] {
  const normalized = values.map((value) => value.trim()).filter(Boolean)
  const unique = Array.from(new Set(normalized))
  if (unique.length === 0) throw new Error(`CHAPTER_PLAN_ASSET_MENU_EMPTY:${label}`)
  if (unique.length !== normalized.length) throw new Error(`CHAPTER_PLAN_ASSET_NAME_DUPLICATE:${label}`)
  return unique as [string, ...string[]]
}

export function buildChapterPlanOutputSchema(assetMenu: ChapterPlanAssetMenu) {
  const locationNames = nonEmptyEnum(assetMenu.locations.map((asset) => asset.name), 'location')
  const characterNames = nonEmptyEnum(assetMenu.characters.map((asset) => asset.name), 'character')
  const dynamicShotSchema = chapterPlanRawShotSchema.extend({
    scene: chapterPlanRawShotSchema.shape.scene.extend({
      locationName: z.enum(locationNames),
    }).strict(),
    characters: z.array(chapterPlanRawShotSchema.shape.characters.element.extend({
      characterName: z.enum(characterNames),
    }).strict()).min(0).max(20),
    dialogue: z.array(chapterPlanRawShotSchema.shape.dialogue.element.extend({
      speakerName: z.enum(characterNames),
    }).strict()).min(0).max(20),
  }).strict()
  return z.object({
    shots: z.array(dynamicShotSchema).min(1).max(60),
    generationSegments: chapterPlanRawOutputSchema.shape.generationSegments,
  }).strict()
}

export function resolveChapterPlanOutputReferences(raw: unknown, assetMenu: ChapterPlanAssetMenu): ChapterPlanOutput {
  const parsed = buildChapterPlanOutputSchema(assetMenu).parse(raw)
  const locationByName = new Map(assetMenu.locations.map((asset) => [asset.name, asset]))
  const characterByName = new Map(assetMenu.characters.map((asset) => [asset.name, asset]))
  return {
    shots: parsed.shots.map((shot) => {
      const location = locationByName.get(shot.scene.locationName)
      if (!location) {
        throw new AppError('PLAN_VALIDATION_FAILED', `PLAN_VALIDATION_FAILED:LOCATION_NAME_UNKNOWN:${shot.scene.locationName}`, {
          details: {
            assetKind: 'location',
            assetName: shot.scene.locationName,
          },
        })
      }
      return {
        shotId: shot.shotRef,
        shotNumber: shot.shotNumber,
        shotPurpose: shot.shotPurpose,
        durationSec: shot.durationSec,
        scene: {
          locationId: location.id,
          name: location.name,
          subScene: shot.scene.subScene,
        },
        action: shot.action,
        characters: shot.characters.map(({ characterName, ...character }) => {
          const asset = characterByName.get(characterName)
          if (!asset) {
            throw new AppError('PLAN_VALIDATION_FAILED', `PLAN_VALIDATION_FAILED:CHARACTER_NAME_UNKNOWN:${characterName}`, {
              details: {
                assetKind: 'character',
                assetName: characterName,
              },
            })
          }
          return {
            ...character,
            characterId: asset.id,
            name: asset.name,
          }
        }),
        keyObjects: shot.keyObjects,
        dialogue: shot.dialogue.map(({ speakerName, line }) => {
          const speaker = characterByName.get(speakerName)
          if (!speaker) {
            throw new AppError('PLAN_VALIDATION_FAILED', `PLAN_VALIDATION_FAILED:DIALOGUE_SPEAKER_UNKNOWN:${speakerName}`, {
              details: { assetKind: 'character', assetName: speakerName },
            })
          }
          return { characterId: speaker.id, line }
        }),
        sound: shot.sound,
      }
    }),
    generationSegments: parsed.generationSegments.map((segment) => ({
      shotIds: segment.shotRefs,
      continuity: segment.continuity,
    })),
  }
}

export function normalizeChapterPlanOutput(raw: unknown, assetMenu: ChapterPlanAssetMenu): NormalizedChapterPlanOutput {
  const parsed = resolveChapterPlanOutputReferences(raw, assetMenu)
  const normalizedCore = normalizeEditScriptStructure({
    shots: parsed.shots,
    generationSegments: parsed.generationSegments,
  })
  return {
    ...normalizedCore,
    shots: normalizedCore.shots,
    generationSegments: normalizedCore.generationSegments,
  }
}
