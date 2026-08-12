import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import {
  PRODUCTION_PROFILE_IDS,
  type ProductionProfileDefinition,
  type ProductionProfileId,
} from './types'

export const DEFAULT_PRODUCTION_PROFILE_ID = 'narrative_video' as const satisfies ProductionProfileId

function defineProductionProfile(
  definition: ProductionProfileDefinition,
): ProductionProfileDefinition {
  return definition
}

export const PRODUCTION_PROFILE_REGISTRY: Readonly<
  Record<ProductionProfileId, ProductionProfileDefinition>
> = {
  narrative_video: defineProductionProfile({
    id: 'narrative_video',
    version: 1,
    purpose: 'Narrative film, series, short-drama, and story-led video production.',
    allowedDomains: ['story', 'direction', 'assets', 'video', 'music'],
    developerInstructions: [],
    domainInstructions: {},
    // The existing narrative workspace remains unchanged. It intentionally
    // does not opt into the new commercial journey surface.
    journey: null,
  }),
  commercial_video: defineProductionProfile({
    id: 'commercial_video',
    version: 1,
    purpose: 'Advertising, campaign, brand-promotion, and product-marketing video production.',
    allowedDomains: [
      'commercial_brief',
      'commercial_script',
      'direction',
      'assets',
      'video',
      'music',
    ],
    developerInstructions: [
      'This Project is a commercial_video production. commercial_brief owns verified campaign, audience, product, claim, channel, and CTA facts; commercial_script owns the executable timed commercial content. Do not create or use screenplay as this Project\'s script authority.',
      'A commercial brief and commercial script that will govern downstream production are durable dependencies: save each exact professional object through save_project_document before dependent direction, assets, voice, video, or music work, and pass exact Resource versions as references. Never choose among multiple briefs or scripts by recency, name similarity, message order, or Canvas position.',
      'The shared creative-direction, asset, video, and music Skills remain the only owners of their domains. In this profile, treat the exact commercial_script as the script/source text those Skills refer to, without importing commercial claims or CTA ownership into them.',
      'Product facts, performance claims, prices, offers, legal qualifiers, brand spelling, logos, packaging text, and calls to action must come from the user or exact provided Resources. Never invent or silently strengthen them. Exact logos and packaging graphics are source material, not images to redraw and present as authoritative brand assets.',
      'The story-direction alignment checkpoint does not apply merely because the commercial concept is short or incomplete. Apply only the existing checkpoint families whose actual conditions are met; otherwise declare revisable assumptions and continue.',
    ],
    domainInstructions: {
      direction: [
        'For this commercial_video Project, every reference to the screenplay or exact script in this Skill means the exact commercial_script Resource. Direction still owns only how to present it and cannot change its campaign facts, sequence, claims, CTA, or fixed timing.',
      ],
      assets: [
        'For this commercial_video Project, every reference to the screenplay or exact script in this Skill means the exact commercial_script Resource. Treat a reusable product or packaging identity as a prop under the existing asset vocabulary; preserve exact supplied logos and packaging as references instead of redrawing them as authoritative brand art.',
      ],
      video: [
        'For this commercial_video Project, every reference to the screenplay or exact script in this Skill means the exact commercial_script Resource. It exclusively owns what appears, sequence, dialogue, on-screen text, claims, CTA, and fixed timing; this Skill only turns that content into executable video segments.',
      ],
      music: [
        'For this commercial_video Project, every reference to the locked screenplay means the exact commercial_script Resource. Music may support the commercial timeline but cannot modify facts, claims, order, on-screen text, CTA, or duration.',
      ],
    },
    journey: [
      {
        id: 'brief',
        schemaIds: [WORKSPACE_RESOURCE_SCHEMA.COMMERCIAL_BRIEF],
      },
      {
        id: 'script',
        schemaIds: [WORKSPACE_RESOURCE_SCHEMA.COMMERCIAL_SCRIPT],
      },
      {
        id: 'direction',
        schemaIds: [WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION],
      },
      {
        id: 'assets',
        schemaIds: [
          WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
          WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
          WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE,
        ],
      },
      {
        id: 'video',
        schemaIds: [WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT],
      },
      {
        id: 'audio',
        schemaIds: [
          WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
          WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        ],
      },
      {
        id: 'final',
        schemaIds: [
          WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO,
          WORKSPACE_RESOURCE_SCHEMA.RENDERED_VIDEO,
        ],
      },
    ],
  }),
}

export function isProductionProfileId(value: string): value is ProductionProfileId {
  return (PRODUCTION_PROFILE_IDS as readonly string[]).includes(value)
}

export function requireProductionProfileDefinition(
  profileId: string,
  profileVersion?: number,
): ProductionProfileDefinition {
  if (!isProductionProfileId(profileId)) {
    throw new Error(`PRODUCTION_PROFILE_UNKNOWN:${profileId}`)
  }
  const definition = PRODUCTION_PROFILE_REGISTRY[profileId]
  if (profileVersion !== undefined && definition.version !== profileVersion) {
    throw new Error(
      `PRODUCTION_PROFILE_VERSION_UNSUPPORTED:${profileId}:${String(profileVersion)}`,
    )
  }
  return definition
}
