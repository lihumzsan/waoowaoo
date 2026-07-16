import {
  buildAssetReviewChoiceCard,
  buildBibleReviewChoiceCard,
  buildScriptReviewChoiceCard,
  buildStyleAndRatioChoiceCard,
  type ProjectAgentChoiceOfferCandidate,
} from './choice-card'
import {
  resolveAssetReviewChoiceResource,
  resolveBibleReviewChoiceResource,
  resolveScriptIntakeChoiceResource,
  resolveScriptReviewChoiceResource,
  resolveStyleChoiceResource,
  type ProjectAgentChoiceReviewedResource,
  type ProjectAgentChoiceReviewedResourceKind,
} from './choice-offer'
import {
  parseAssetReviewChoiceDecision,
  parseBibleReviewChoiceDecision,
  parseScriptIntakeChoiceDecision,
  parseScriptReviewChoiceDecision,
  parseStyleChoiceDecision,
  type EditFirstChoiceDecision,
  type EditFirstChoiceDecisionInput,
} from './edit-first-choice-result'
import type { ProjectAgentLocale } from './locale'
import type { ProjectAgentChoiceCardPartData } from './types'
import type { Prisma } from '@prisma/client'

export const EDIT_FIRST_CHOICE_TYPES = [
  'script_intake',
  'script_review',
  'bible_review',
  'style',
  'asset_review',
] as const

export type EditFirstChoiceType = (typeof EDIT_FIRST_CHOICE_TYPES)[number]

interface EditFirstChoiceOfferBuilderParams {
  projectId: string
  userId: string
  episodeId: string
  locale: ProjectAgentLocale
  toolCallId: string
}

interface EditFirstChoiceResourceResolverParams {
  tx: Prisma.TransactionClient
  projectId: string
  userId: string
  episodeId: string
  card: ProjectAgentChoiceCardPartData
}

interface EditFirstChoiceDefinition {
  readonly choiceType: EditFirstChoiceType
  readonly toolId: string
  readonly reviewedResourceKind: ProjectAgentChoiceReviewedResourceKind
  readonly offerBuilder:
    | { readonly kind: 'persisted_payload' }
    | {
        readonly kind: 'runtime'
        readonly build: (params: EditFirstChoiceOfferBuilderParams) => Promise<ProjectAgentChoiceOfferCandidate>
      }
  readonly parseDecision: (input: EditFirstChoiceDecisionInput) => EditFirstChoiceDecision | null
  readonly serializeDecision: (decision: EditFirstChoiceDecision) => Record<string, unknown>
  /**
   * A structured user confirmation whose complete Operation input is already
   * present in the persisted Choice decision. These commands are committed by
   * the Choice consumption transaction; the model must not relay them.
   *
   * Non-confirmation submissions and creative revision requests return null
   * until their Task/Approval handoff or revision input contract is owned by a
   * deterministic server executor.
   */
  readonly resolveAtomicConfirmationCommand: (
    decision: EditFirstChoiceDecision,
  ) => EditFirstChoiceAtomicConfirmationCommand | null
  readonly resolveReviewedResource: (
    params: EditFirstChoiceResourceResolverParams,
  ) => Promise<ProjectAgentChoiceReviewedResource>
}

function defineEditFirstChoice(
  definition: EditFirstChoiceDefinition,
): EditFirstChoiceDefinition {
  return definition
}

export type EditFirstChoiceAtomicConfirmationCommand =
  | { readonly operationId: 'approve_script'; readonly input: Record<string, never> }
  | { readonly operationId: 'confirm_bible'; readonly input: { readonly aspectRatio: '9:16' | '16:9' | '21:9' } }
  | { readonly operationId: 'confirm_edit_style_preview'; readonly input: Record<string, never> }
  | { readonly operationId: 'approve_edit_script_assets'; readonly input: Record<string, never> }

function assertDecisionType(
  decision: { readonly choiceType: EditFirstChoiceType },
  choiceType: EditFirstChoiceType,
): void {
  if (decision.choiceType !== choiceType) {
    throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:${choiceType}:${decision.choiceType}`)
  }
}

export const EDIT_FIRST_CHOICE_REGISTRY = {
  script_intake: defineEditFirstChoice({
    choiceType: 'script_intake',
    toolId: 'request_script_intake_choice',
    reviewedResourceKind: 'script_intake_prompt',
    offerBuilder: { kind: 'persisted_payload' },
    parseDecision: (input) => parseScriptIntakeChoiceDecision(input),
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'script_intake') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:script_intake:${decision.choiceType}`)
      }
      return { decision: decision.decision, normalizedBrief: decision.normalizedBrief }
    },
    resolveAtomicConfirmationCommand: () => null,
    resolveReviewedResource: async (params) => await resolveScriptIntakeChoiceResource(params),
  }),
  script_review: defineEditFirstChoice({
    choiceType: 'script_review',
    toolId: 'request_edit_script_review_choice',
    reviewedResourceKind: 'script_review_document',
    offerBuilder: { kind: 'runtime', build: async (params) => await buildScriptReviewChoiceCard(params) },
    parseDecision: (input) => parseScriptReviewChoiceDecision(input),
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'script_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:script_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { decision: 'approve' }
        : { decision: 'revise', revisionNotes: decision.revisionNotes }
    },
    resolveAtomicConfirmationCommand: (decision) => {
      if (decision.choiceType !== 'script_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:script_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { operationId: 'approve_script', input: {} }
        : null
    },
    resolveReviewedResource: async (params) => await resolveScriptReviewChoiceResource(params),
  }),
  bible_review: defineEditFirstChoice({
    choiceType: 'bible_review',
    toolId: 'request_edit_bible_review_choice',
    reviewedResourceKind: 'bible_review_plan',
    offerBuilder: { kind: 'runtime', build: async (params) => await buildBibleReviewChoiceCard(params) },
    parseDecision: (input) => parseBibleReviewChoiceDecision(input),
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'bible_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:bible_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { decision: 'approve', aspectRatio: decision.aspectRatio }
        : { decision: 'revise', revisionNotes: decision.revisionNotes }
    },
    resolveAtomicConfirmationCommand: (decision) => {
      if (decision.choiceType !== 'bible_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:bible_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { operationId: 'confirm_bible', input: { aspectRatio: decision.aspectRatio } }
        : null
    },
    resolveReviewedResource: async (params) => await resolveBibleReviewChoiceResource(params),
  }),
  style: defineEditFirstChoice({
    choiceType: 'style',
    toolId: 'request_edit_style_choice',
    reviewedResourceKind: 'style_preview_set',
    offerBuilder: { kind: 'runtime', build: async (params) => await buildStyleAndRatioChoiceCard(params) },
    parseDecision: (input) => parseStyleChoiceDecision(input),
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'style') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:style:${decision.choiceType}`)
      }
      return {
        decision: decision.decision,
        stylePreviewId: decision.stylePreviewId,
        saved: true,
      }
    },
    resolveAtomicConfirmationCommand: (decision) => {
      assertDecisionType(decision, 'style')
      return { operationId: 'confirm_edit_style_preview', input: {} }
    },
    resolveReviewedResource: async (params) => await resolveStyleChoiceResource(params),
  }),
  asset_review: defineEditFirstChoice({
    choiceType: 'asset_review',
    toolId: 'request_edit_asset_review_choice',
    reviewedResourceKind: 'asset_review_set',
    offerBuilder: { kind: 'runtime', build: async (params) => await buildAssetReviewChoiceCard(params) },
    parseDecision: (input) => parseAssetReviewChoiceDecision(input),
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'asset_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:asset_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { decision: 'approve' }
        : { decision: 'revise', revisionNotes: decision.revisionNotes }
    },
    resolveAtomicConfirmationCommand: (decision) => {
      if (decision.choiceType !== 'asset_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:asset_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { operationId: 'approve_edit_script_assets', input: {} }
        : null
    },
    resolveReviewedResource: async (params) => await resolveAssetReviewChoiceResource(params),
  }),
} as const satisfies Record<EditFirstChoiceType, EditFirstChoiceDefinition>

export function getEditFirstChoiceDefinition(
  choiceType: EditFirstChoiceType,
): EditFirstChoiceDefinition {
  return EDIT_FIRST_CHOICE_REGISTRY[choiceType]
}

export function resolveEditFirstChoiceAtomicConfirmationCommand(
  decision: EditFirstChoiceDecision,
): EditFirstChoiceAtomicConfirmationCommand | null {
  return getEditFirstChoiceDefinition(decision.choiceType)
    .resolveAtomicConfirmationCommand(decision)
}

type EditFirstChoiceToolIdMap = {
  readonly [ChoiceType in EditFirstChoiceType]: (typeof EDIT_FIRST_CHOICE_REGISTRY)[ChoiceType]['toolId']
}

export const EDIT_FIRST_CHOICE_TOOL_IDS = Object.fromEntries(
  EDIT_FIRST_CHOICE_TYPES.map((choiceType) => [choiceType, EDIT_FIRST_CHOICE_REGISTRY[choiceType].toolId]),
) as EditFirstChoiceToolIdMap

export type EditFirstChoiceToolId = EditFirstChoiceToolIdMap[EditFirstChoiceType]

export const EDIT_FIRST_CHOICE_OPERATION_IDS: readonly EditFirstChoiceToolId[] = EDIT_FIRST_CHOICE_TYPES.map(
  (choiceType) => EDIT_FIRST_CHOICE_TOOL_IDS[choiceType],
)

export function isEditFirstChoiceType(value: unknown): value is EditFirstChoiceType {
  return typeof value === 'string' && Object.hasOwn(EDIT_FIRST_CHOICE_REGISTRY, value)
}

export function isEditFirstChoiceToolId(operationId: string): operationId is EditFirstChoiceToolId {
  return EDIT_FIRST_CHOICE_OPERATION_IDS.some((candidate) => candidate === operationId)
}
