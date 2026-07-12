import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import type {
  ProjectAgentChoiceCardDefinition,
  ProjectAgentChoiceCardPartData,
} from './types'
import {
  getEditFirstChoiceDefinition,
  isEditFirstChoiceType,
  type EditFirstChoiceType,
} from './edit-first-choice-tools'
import {
  parseEditFirstChoiceDecision,
  type EditFirstChoiceDecision,
} from './edit-first-choice-result'

const choiceTypeSchema = z.custom<EditFirstChoiceType>(isEditFirstChoiceType)

const choiceCardOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  meta: z.string().nullable().optional(),
}).strict()

const choiceCardGroupSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  presentation: z.enum(['options', 'aspect_ratio', 'image']),
  options: z.array(choiceCardOptionSchema),
}).strict()

const choiceCardSubmitSchema = z.object({
  kind: z.literal('submit_tool_output'),
  decision: z.enum(['approve', 'select']),
}).strict()

export const projectAgentChoiceCardSchema = z.object({
  cardId: z.string().min(1),
  runId: z.string().min(1),
  interruptionId: z.string().min(1),
  toolCallId: z.string().min(1),
  choiceType: choiceTypeSchema,
  variant: z.enum(['choice', 'confirm', 'confirm_or_reply']).optional(),
  replyMode: z.enum(['whole_card', 'per_group']),
  autoSubmitOnReady: z.boolean().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  groups: z.array(choiceCardGroupSchema),
  submitLabel: z.string().min(1),
  submit: choiceCardSubmitSchema,
  replyLabel: z.string().nullable().optional(),
  replyPlaceholder: z.string().nullable().optional(),
  replySubmitLabel: z.string().nullable().optional(),
  replyToolOutputKey: z.string().nullable().optional(),
}).strict()

export const CHOICE_REVIEWED_RESOURCE_KINDS = [
  'script_intake_prompt',
  'script_review_document',
  'bible_review_plan',
  'style_preview_set',
  'asset_review_set',
] as const

export type ProjectAgentChoiceReviewedResourceKind = (typeof CHOICE_REVIEWED_RESOURCE_KINDS)[number]

const choiceReviewedResourceSchema = z.object({
  kind: z.enum(CHOICE_REVIEWED_RESOURCE_KINDS),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

const projectAgentChoiceOfferSchema = z.object({
  card: projectAgentChoiceCardSchema,
  reviewedResource: choiceReviewedResourceSchema,
}).strict()

export interface ProjectAgentChoiceReviewedResource {
  kind: ProjectAgentChoiceReviewedResourceKind
  fingerprint: string
}

export interface ProjectAgentChoiceOffer {
  card: ProjectAgentChoiceCardPartData
  reviewedResource: ProjectAgentChoiceReviewedResource
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson }

function canonicalize(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PROJECT_AGENT_CHOICE_FINGERPRINT_VALUE_INVALID')
    return value
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
    )
  }
  throw new Error('PROJECT_AGENT_CHOICE_FINGERPRINT_VALUE_INVALID')
}

export function fingerprintProjectAgentChoiceResource(input: {
  kind: ProjectAgentChoiceReviewedResourceKind
  snapshot: unknown
}): ProjectAgentChoiceReviewedResource {
  const fingerprint = createHash('sha256')
    .update(input.kind)
    .update('\n')
    .update(JSON.stringify(canonicalize(input.snapshot)))
    .digest('hex')
  return { kind: input.kind, fingerprint }
}

export function buildProjectAgentChoiceOffer(params: {
  runId: string
  interruptionId: string
  card: ProjectAgentChoiceCardDefinition
  reviewedResource: ProjectAgentChoiceReviewedResource
}): ProjectAgentChoiceOffer {
  const offer: ProjectAgentChoiceOffer = {
    card: {
      ...params.card,
      runId: params.runId,
      interruptionId: params.interruptionId,
    },
    reviewedResource: params.reviewedResource,
  }
  return parseProjectAgentChoiceOffer(offer)
}

export function parseProjectAgentChoiceOffer(value: Prisma.JsonValue | unknown): ProjectAgentChoiceOffer {
  const parsed = projectAgentChoiceOfferSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`PROJECT_AGENT_CHOICE_OFFER_INVALID:${parsed.error.issues.map((issue) => issue.path.join('.')).join(',')}`)
  }
  return parsed.data
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertOfferSelections(offer: ProjectAgentChoiceOffer, response: unknown): void {
  if (!isRecord(response)) throw new Error('PROJECT_AGENT_CHOICE_RESPONSE_INVALID')
  const selections = isRecord(response.selections) ? response.selections : {}
  const allowedKeys = new Set(offer.card.groups.map((group) => group.key))
  for (const key of Object.keys(selections)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`PROJECT_AGENT_CHOICE_SELECTION_KEY_INVALID:${key}`)
    }
  }
  for (const group of offer.card.groups) {
    const selectedValue = selections[group.key]
    const topLevelValue = response[group.key]
    const value = typeof selectedValue === 'string'
      ? selectedValue.trim()
      : typeof topLevelValue === 'string'
        ? topLevelValue.trim()
        : ''
    if (!value) {
      if (group.required && response.decision !== 'revise') {
        throw new Error(`PROJECT_AGENT_CHOICE_SELECTION_REQUIRED:${group.key}`)
      }
      continue
    }
    if (!group.options.some((option) => option.value === value)) {
      throw new Error(`PROJECT_AGENT_CHOICE_SELECTION_NOT_OFFERED:${group.key}:${value}`)
    }
  }
}

export function parseProjectAgentChoiceDecision(params: {
  offer: ProjectAgentChoiceOffer
  response: Prisma.InputJsonValue
  latestUserText: string
}): EditFirstChoiceDecision {
  assertOfferSelections(params.offer, params.response)
  const decision = parseEditFirstChoiceDecision({
    choiceType: params.offer.card.choiceType,
    output: params.response as Record<string, unknown>,
    latestUserText: params.latestUserText,
  })
  if (!decision) throw new Error('PROJECT_AGENT_CHOICE_RESPONSE_INVALID')
  return decision
}

export function expectedReviewedResourceKind(choiceType: EditFirstChoiceType): ProjectAgentChoiceReviewedResourceKind {
  return getEditFirstChoiceDefinition(choiceType).reviewedResourceKind
}

interface ChoiceResourceResolverParams {
  tx: Prisma.TransactionClient
  projectId: string
  userId: string
  episodeId: string
  card: ProjectAgentChoiceCardPartData
}

export async function resolveScriptIntakeChoiceResource(
  params: ChoiceResourceResolverParams,
): Promise<ProjectAgentChoiceReviewedResource> {
  return fingerprintProjectAgentChoiceResource({
    kind: 'script_intake_prompt',
    snapshot: {
      cardId: params.card.cardId,
      choiceType: params.card.choiceType,
      groups: params.card.groups,
    },
  })
}

export async function resolveScriptReviewChoiceResource(
  params: ChoiceResourceResolverParams,
): Promise<ProjectAgentChoiceReviewedResource> {
  const editBible = await params.tx.projectEditBible.findFirst({
    where: {
      episodeId: params.episodeId,
      episode: {
        projectId: params.projectId,
        project: { userId: params.userId },
      },
    },
    select: {
      id: true,
      status: true,
      version: true,
      updatedAt: true,
      sourceDocument: {
        select: {
          id: true,
          sourceKind: true,
          checksum: true,
          version: true,
          normalizedText: true,
          updatedAt: true,
        },
      },
    },
  })
  if (!editBible) throw new Error('PROJECT_AGENT_CHOICE_REVIEWED_RESOURCE_MISSING')
  return fingerprintProjectAgentChoiceResource({ kind: 'script_review_document', snapshot: editBible })
}

export async function resolveBibleReviewChoiceResource(
  params: ChoiceResourceResolverParams,
): Promise<ProjectAgentChoiceReviewedResource> {
  const editBible = await params.tx.projectEditBible.findFirst({
    where: {
      episodeId: params.episodeId,
      episode: {
        projectId: params.projectId,
        project: { userId: params.userId },
      },
    },
    select: {
      id: true,
      status: true,
      version: true,
      bibleJson: true,
      beatSheetJson: true,
      ledgerJson: true,
      emotionalCurveJson: true,
      styleBibleJson: true,
      diagnosticsJson: true,
      updatedAt: true,
      sourceDocument: {
        select: {
          id: true,
          checksum: true,
          version: true,
          updatedAt: true,
        },
      },
    },
  })
  if (!editBible) throw new Error('PROJECT_AGENT_CHOICE_REVIEWED_RESOURCE_MISSING')
  return fingerprintProjectAgentChoiceResource({ kind: 'bible_review_plan', snapshot: editBible })
}

export async function resolveStyleChoiceResource(
  params: ChoiceResourceResolverParams,
): Promise<ProjectAgentChoiceReviewedResource> {
  const [project, editBible] = await Promise.all([
    params.tx.project.findFirst({
      where: { id: params.projectId, userId: params.userId },
      select: { id: true, videoRatio: true },
    }),
    params.tx.projectEditBible.findFirst({
      where: {
        episodeId: params.episodeId,
        episode: {
          projectId: params.projectId,
          project: { userId: params.userId },
        },
      },
      select: {
        id: true,
        status: true,
        version: true,
        stylePreviews: {
          where: { status: { in: ['completed', 'confirmed'] } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            styleKey: true,
            title: true,
            summary: true,
            imageKey: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    }),
  ])
  if (!project || !editBible) throw new Error('PROJECT_AGENT_CHOICE_REVIEWED_RESOURCE_MISSING')
  return fingerprintProjectAgentChoiceResource({
    kind: 'style_preview_set',
    snapshot: {
      project,
      bible: {
        id: editBible.id,
        status: editBible.status,
        version: editBible.version,
      },
      stylePreviews: editBible.stylePreviews,
    },
  })
}

export async function resolveAssetReviewChoiceResource(
  params: ChoiceResourceResolverParams,
): Promise<ProjectAgentChoiceReviewedResource> {
  const editScripts = await params.tx.projectEditScript.findMany({
    where: {
      projectId: params.projectId,
      episodeId: params.episodeId,
      project: { userId: params.userId },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      chapterId: true,
      updatedAt: true,
      requirements: {
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          kind: true,
          name: true,
          status: true,
          targetId: true,
          updatedAt: true,
          errorMessage: true,
        },
      },
    },
  })
  return fingerprintProjectAgentChoiceResource({ kind: 'asset_review_set', snapshot: editScripts })
}

export async function resolveCurrentProjectAgentChoiceReviewedResource(
  params: ChoiceResourceResolverParams,
): Promise<ProjectAgentChoiceReviewedResource> {
  return await getEditFirstChoiceDefinition(params.card.choiceType).resolveReviewedResource(params)
}

export async function assertProjectAgentChoiceOfferCurrent(params: {
  tx: Prisma.TransactionClient
  projectId: string
  userId: string
  episodeId: string | null | undefined
  offer: ProjectAgentChoiceOffer
}): Promise<void> {
  if (!params.episodeId) throw new Error('PROJECT_AGENT_CHOICE_EPISODE_ID_REQUIRED')
  const expectedKind = expectedReviewedResourceKind(params.offer.card.choiceType)
  if (params.offer.reviewedResource.kind !== expectedKind) {
    throw new Error('PROJECT_AGENT_CHOICE_REVIEWED_RESOURCE_KIND_INVALID')
  }
  const current = await resolveCurrentProjectAgentChoiceReviewedResource({
    tx: params.tx,
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    card: params.offer.card,
  })
  if (current.fingerprint !== params.offer.reviewedResource.fingerprint) {
    throw new Error('PROJECT_AGENT_CHOICE_OFFER_STALE')
  }
}
