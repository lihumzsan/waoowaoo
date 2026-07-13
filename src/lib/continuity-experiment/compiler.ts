import type { Locale } from '@/i18n/routing'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import { buildAiPrompt } from '@/lib/ai-prompts/build-prompt'
import {
  findContinuityExperimentShot,
  findContinuityExperimentStory,
  type ContinuityExperimentStoryId,
  type ContinuityExperimentVariantId,
} from './catalog'

export const CONTINUITY_EXPERIMENT_COMPILER_VERSION = 'continuity-lab-v1'

export interface ContinuityExperimentCellInput {
  readonly storyId: ContinuityExperimentStoryId
  readonly variantId: ContinuityExperimentVariantId
  readonly shotId: string
}

export function continuityExperimentCellId(input: ContinuityExperimentCellInput): string {
  return `${input.storyId}:${input.variantId}:${input.shotId}`
}

export function compileContinuityExperimentCell(input: ContinuityExperimentCellInput & { locale: Locale }) {
  const story = findContinuityExperimentStory(input.storyId)
  const shot = findContinuityExperimentShot(story, input.shotId)
  const basePacket = {
    compilerVersion: CONTINUITY_EXPERIMENT_COMPILER_VERSION,
    storyId: story.id,
    shotId: shot.id,
    story: story.logline,
    visualStyle: story.style,
    fixedAssetManifest: story.assets,
    shot: {
      camera: shot.camera,
      action: shot.action,
      composition: shot.composition,
    },
  }

  const packet = input.variantId === 'baseline'
    ? {
        ...basePacket,
        protocol: 'baseline_independent_panel',
      }
    : input.variantId === 'spatial'
      ? {
          ...basePacket,
          protocol: 'camera_independent_topology',
          topology: story.topology,
          cameraVantage: {
            id: shot.vantageId,
            description: story.vantages[shot.vantageId],
          },
          spatialInvariants: story.invariants,
          renderState: shot.after,
        }
      : {
          ...basePacket,
          protocol: 'full_text_continuity',
          referenceBindings: [
            'CHARACTER_MASTER controls identity, face, hair, body proportions and costume only; never copy its pose, background or camera.',
            'LOCATION_MASTER controls immutable geometry, materials and fixed facilities only; never copy people, transient object states, display values or door states.',
            'PROP_MASTER controls object identity, size, material and markings only; never duplicate it or copy its placement from a reference.',
          ],
          topology: story.topology,
          cameraVantage: {
            id: shot.vantageId,
            description: story.vantages[shot.vantageId],
          },
          spatialInvariants: story.invariants,
          stateBefore: shot.before,
          stateDelta: shot.delta,
          stateAfter: shot.after,
          renderRule: 'Render stateAfter at the decisive instant described by stateDelta. stateBefore is context only and must not appear as a second pose, duplicate person or duplicate object.',
        }

  const packetJson = JSON.stringify(packet, null, 2)
  const prompt = buildAiPrompt({
    promptId: AI_PROMPT_IDS.CONTINUITY_EXPERIMENT_IMAGE,
    locale: input.locale,
    variables: {
      experiment_packet_json: packetJson,
    },
  })

  return {
    cellId: continuityExperimentCellId(input),
    storyId: story.id,
    variantId: input.variantId,
    shotId: shot.id,
    prompt,
    packet,
  }
}
