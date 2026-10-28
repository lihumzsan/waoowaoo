import { z } from 'zod'
import {
  COMPOSITION_TARGETS,
  validateCompositionTarget,
} from '@/lib/video-compose/composition-target-registry'
import { resolveCompositionTiming } from '@/lib/video-compose/composition-timing'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import {
  videoCompositionSchema,
  compositionFormatSchema,
  compositionTargetSchema,
} from '@/lib/video-compose/composition-contract'
import { compositionSourceFactsSchema } from '@/lib/video-compose/composition-contract'
import { videoMergeCuePlacementSchema } from '@/lib/video-compose/audio-contract'
import { jianyingProfileSchema } from '@/lib/jianying/profile'
import { workspaceResourceLifecycleProjectionSchema } from './task-runtime-envelope'

export const videoMergeRecipeSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    locale: z.enum(['zh', 'en']),
    composition: videoCompositionSchema,
    outputTarget: compositionTargetSchema,
    format: compositionFormatSchema,
    sourceFacts: z.array(compositionSourceFactsSchema).min(1).max(50),
    jianyingProfile: jianyingProfileSchema.nullable(),
  })
  .strict()
  .superRefine((recipe, ctx) => {
    if (
      (recipe.outputTarget === 'jianying_project') !==
      (recipe.jianyingProfile !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'COMPOSITION_PROFILE_TARGET_MISMATCH',
      })
    if (recipe.format.frameRate !== recipe.sourceFacts[0]?.frameRate) ctx.addIssue({code:'custom',message:'COMPOSITION_FRAME_RATE_MISMATCH'})
    if (recipe.sourceFacts.length !== recipe.composition.clips.length)
      ctx.addIssue({ code: 'custom', message: 'COMPOSITION_FACTS_INCOMPLETE' })
  })

const inputRef = z
  .object({
    resourceId: z.string().trim().min(1),
    contentVersion: z.number().int().positive(),
    workspacePath: z.string().trim().min(1).max(512),
    role: z.enum([
      'source_video',
      'background_music',
      'replacement_audio',
      'bgm_audio',
      'sound_effect_audio',
      'character_context',
      'editing_context',
    ]),
    position: z.number().int().nonnegative(),
  })
  .strict()
export const workspaceResourceVideoMergeTaskPayloadSchema = z
  .object({
    lifecycleProjection: workspaceResourceLifecycleProjectionSchema,
    protocol: z.literal('workspace_resource_video_merge_v3'),
    resource: z
      .object({
        resourceId: z.string().trim().min(1),
        mediaType: z.enum(['video', 'archive']),
        schemaId: z.enum(['generic.video', 'project.jianying_project']),
        prompt: z.null(),
        modelKey: z.null(),
        inputHash: z.string().length(64),
        inputs: z.array(inputRef).min(1).max(168),
        generationOptions: videoMergeRecipeSchema,
        musicCues: z.array(videoMergeCuePlacementSchema).max(50),
        soundCues: z.array(videoMergeCuePlacementSchema).max(50),
        toolCallId: z.string().trim().min(1).nullable(),
      })
      .strict()
      .superRefine((resource, ctx) => {
        const recipe = resource.generationOptions
        const { composition, sourceFacts, outputTarget } = recipe
        const issue = (message: string) =>
          ctx.addIssue({ code: 'custom', message })
        const target = COMPOSITION_TARGETS[outputTarget]
        if (
          resource.mediaType !== target.mediaType ||
          resource.schemaId !== target.schemaId
        )
          issue('COMPOSITION_OUTPUT_TARGET_MISMATCH')
        try {
          validateCompositionTarget(outputTarget, composition)
          resolveCompositionTiming(composition,recipe.format.frameRate)
        } catch {
          issue('COMPOSITION_TARGET_OR_TIMING_INVALID')
        }
        if (
          new Set(resource.inputs.map((ref) => ref.position)).size !==
          resource.inputs.length
        )
          issue('COMPOSITION_INPUT_POSITIONS_DUPLICATE')
        const videos = resource.inputs.filter(
          (ref) => ref.role === 'source_video',
        )
        if (videos.length !== composition.clips.length)
          issue('COMPOSITION_VIDEO_INPUT_COUNT_INVALID')
        for (const [index, clip] of composition.clips.entries()) {
          const ref = videos[index]
          const fact = sourceFacts[index]
          if (
            !ref ||
            ref.resourceId !== clip.source.resourceId ||
            ref.contentVersion !== clip.source.contentVersion ||
            !fact ||
            fact.position !== ref.position
          )
            issue('COMPOSITION_FROZEN_SOURCE_MISMATCH')
          if (fact && clip.sourceStartMs + clip.durationMs > fact.durationMs)
            issue('COMPOSITION_SOURCE_RANGE_INVALID')
        }
        const cueGroups = [
          {
            role: 'bgm_audio',
            placements: resource.musicCues,
            cues: composition.audio.musicCues,
          },
          {
            role: 'sound_effect_audio',
            placements: resource.soundCues,
            cues: composition.audio.soundCues,
          },
        ]
        for (const group of cueGroups) {
          const refs = resource.inputs.filter((ref) => ref.role === group.role)
          if (
            refs.length !== group.cues.length ||
            group.placements.length !== group.cues.length
          )
            issue('COMPOSITION_CUE_COUNT_INVALID')
          for (const [index, cue] of group.cues.entries()) {
            const ref = refs[index]
            const placement = group.placements[index]
            if (
              !ref ||
              ref.resourceId !== cue.resourceId ||
              ref.contentVersion !== cue.contentVersion ||
              !placement ||
              placement.inputPosition !== ref.position
            )
              issue('COMPOSITION_CUE_REFERENCE_MISMATCH')
            if (
              placement &&
              (
                [
                  'startMs',
                  'durationMs',
                  'fadeInMs',
                  'fadeOutMs',
                  'gainDb',
                ] as const
              ).some((key) => placement[key] !== cue[key])
            )
              issue('COMPOSITION_CUE_TIMING_MISMATCH')
          }
        }
        const audio = composition.audio
        for (const [role, reference] of [
          ['background_music', audio.backgroundMusic],
          ['replacement_audio', audio.replacementAudio],
        ] as const) {
          const refs = resource.inputs.filter((ref) => ref.role === role)
          if (
            reference
              ? refs.length !== 1 ||
                refs[0]?.resourceId !== reference.resourceId ||
                refs[0]?.contentVersion !== reference.contentVersion
              : refs.length !== 0
          )
            issue('COMPOSITION_ASSEMBLY_AUDIO_MISMATCH')
        }
      }),
  })
  .strict()
const envelopeSchema = workspaceResourceVideoMergeTaskPayloadSchema
  .extend(taskRuntimePayloadEnvelopeShape)
  .strict()
export type WorkspaceResourceVideoMergeTaskPayload = z.infer<
  typeof workspaceResourceVideoMergeTaskPayloadSchema
>
export function parseWorkspaceResourceVideoMergeTaskPayload(
  value: unknown,
): WorkspaceResourceVideoMergeTaskPayload {
  const parsed = envelopeSchema.parse(value)
  return workspaceResourceVideoMergeTaskPayloadSchema.parse({
    lifecycleProjection: parsed.lifecycleProjection,
    protocol: parsed.protocol,
    resource: parsed.resource,
  })
}
