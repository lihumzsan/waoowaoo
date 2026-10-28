import { z } from 'zod'
import { workspaceResourceReferenceSchema } from '@/lib/workspace-resource/reference-contract'
import { compositionAudioSchema } from './audio-contract'

const identity = z.string().trim().min(1).max(128)
const animationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('fade'),
      durationMs: z.number().int().positive().max(5_000),
    })
    .strict(),
])

export const videoClipSchema = z
  .object({
    clipId: identity,
    source: workspaceResourceReferenceSchema,
    sourceStartMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
  })
  .strict()

export const characterNameLayerSchema = z
  .object({
    layerId: identity,
    clipId: identity,
    startOffsetMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(200).nullable(),
    nameSource: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('character_resource'),
          reference: workspaceResourceReferenceSchema,
        })
        .strict(),
      z.object({ kind: z.literal('user_instruction') }).strict(),
    ]),
    styleKey: z.literal('lower_third'),
    placementKey: z.enum(['bottom_left', 'bottom_right']),
    intro: animationSchema,
    outro: animationSchema,
  })
  .strict()

export const videoCompositionSchema = z
  .object({
    schemaVersion: z.literal(1),
    clips: z.array(videoClipSchema).min(1).max(50),
    textLayers: z.array(characterNameLayerSchema).max(100),
    audio: compositionAudioSchema,
    contextReferences: z.array(workspaceResourceReferenceSchema).max(16),
  })
  .strict()
  .superRefine((composition, context) => {
    const clips = new Map<string, z.infer<typeof videoClipSchema>>()
    for (const [index, clip] of composition.clips.entries()) {
      if (clips.has(clip.clipId))
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'clipId'],
          message: 'clipId must identify one distinct use of a source.',
        })
      clips.set(clip.clipId, clip)
    }
    const layerIds = new Set<string>()
    for (const [index, layer] of composition.textLayers.entries()) {
      const clip = clips.get(layer.clipId)
      const issuePath = ['textLayers', index] as const
      if (layerIds.has(layer.layerId))
        context.addIssue({
          code: 'custom',
          path: [...issuePath, 'layerId'],
          message: 'layerId must be unique.',
        })
      layerIds.add(layer.layerId)
      if (!clip || layer.startOffsetMs + layer.durationMs > clip.durationMs) {
        context.addIssue({
          code: 'custom',
          path: [...issuePath, 'durationMs'],
          message:
            'The entire text interval must be inside its exact clip instance.',
        })
      }
      const animationMs =
        (layer.intro.kind === 'fade' ? layer.intro.durationMs : 0) +
        (layer.outro.kind === 'fade' ? layer.outro.durationMs : 0)
      if (animationMs > layer.durationMs)
        context.addIssue({
          code: 'custom',
          path: [...issuePath, 'intro'],
          message: 'Intro and outro cannot overlap.',
        })
    }
    if (
      composition.audio.musicCues.length + composition.audio.soundCues.length >
        0 &&
      composition.clips.length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['audio'],
        message: 'Timed cues require one complete source timeline.',
      })
    }
  })

export const compositionTargetSchema = z.enum(['mp4', 'jianying_project'])
export type CompositionTarget = z.infer<typeof compositionTargetSchema>
export type VideoComposition = z.infer<typeof videoCompositionSchema>
export type VideoClip = z.infer<typeof videoClipSchema>
export type CharacterNameLayer = z.infer<typeof characterNameLayerSchema>

export const videoEditOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    outputKind: z.literal('video_edit'),
    name: z.string().trim().min(1).max(300),
    folderPath: z.string().trim().min(1).max(512).nullable().optional(),
    outputTarget: z.literal('jianying_project'),
    overview: z.string().trim().min(1).max(8_000),
    composition: videoCompositionSchema,
    assumptions: z.array(z.string().min(1).max(2_000)).max(64),
    warnings: z.array(z.string().min(1).max(2_000)).max(64),
  })
  .strict()

export type VideoEditOutput = z.infer<typeof videoEditOutputSchema>

export const compositionSourceFactsSchema = z
  .object({
    position: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.string().regex(/^[1-9]\d*\/[1-9]\d*$/u),
  })
  .strict()
export type CompositionSourceFacts = z.infer<
  typeof compositionSourceFactsSchema
>

export const compositionFormatSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.string().regex(/^[1-9]\d*:[1-9]\d*$/u),
    resolution: z.string().min(1),
    frameRate: z.string().regex(/^[1-9]\d*\/[1-9]\d*$/u),
  })
  .strict()
export type CompositionFormat = z.infer<typeof compositionFormatSchema>
