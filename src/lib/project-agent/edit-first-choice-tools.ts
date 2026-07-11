import type {
  EditFirstWorkflowAction,
  EditFirstWorkflowChoiceDecision,
  EditFirstWorkflowState,
} from '@/lib/project-workflow/edit-first'
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
  workflow: EditFirstWorkflowState
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
  readonly toWorkflowDecision: (decision: EditFirstChoiceDecision) => EditFirstWorkflowChoiceDecision
  readonly serializeDecision: (decision: EditFirstChoiceDecision) => Record<string, unknown>
  readonly isEnabled: (workflow: EditFirstWorkflowState) => boolean
  readonly resolveWorkflowAction: (
    workflow: EditFirstWorkflowState,
    decision: EditFirstWorkflowChoiceDecision,
  ) => EditFirstWorkflowAction | null
  readonly resolveReviewedResource: (
    params: EditFirstChoiceResourceResolverParams,
  ) => Promise<ProjectAgentChoiceReviewedResource>
}

function workflowAction(
  operationId: EditFirstWorkflowAction['operationId'],
  title: string,
): EditFirstWorkflowAction {
  return { id: operationId, operationId, title }
}

function assertDecisionType(
  decision: { readonly choiceType: EditFirstChoiceType },
  choiceType: EditFirstChoiceType,
): void {
  if (decision.choiceType !== choiceType) {
    throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:${choiceType}:${decision.choiceType}`)
  }
}

export const EDIT_FIRST_CHOICE_REGISTRY = {
  script_intake: {
    choiceType: 'script_intake',
    toolId: 'request_script_intake_choice',
    reviewedResourceKind: 'script_intake_prompt',
    offerBuilder: { kind: 'persisted_payload' },
    parseDecision: (input) => parseScriptIntakeChoiceDecision(input),
    toWorkflowDecision: (decision) => {
      if (decision.choiceType !== 'script_intake') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:script_intake:${decision.choiceType}`)
      }
      return {
        choiceType: 'script_intake',
        decision: decision.decision,
        normalizedBrief: decision.normalizedBrief,
      }
    },
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'script_intake') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:script_intake:${decision.choiceType}`)
      }
      return { decision: decision.decision, normalizedBrief: decision.normalizedBrief }
    },
    isEnabled: (workflow) => workflow.stage === 'ready_to_ingest_script',
    resolveWorkflowAction: (workflow, decision) => {
      assertDecisionType(decision, 'script_intake')
      return workflow.stage === 'ready_to_ingest_script'
        ? workflowAction('ingest_script', 'Generate source script')
        : null
    },
    resolveReviewedResource: async (params) => await resolveScriptIntakeChoiceResource(params),
  },
  script_review: {
    choiceType: 'script_review',
    toolId: 'request_edit_script_review_choice',
    reviewedResourceKind: 'script_review_document',
    offerBuilder: { kind: 'runtime', build: async (params) => await buildScriptReviewChoiceCard(params) },
    parseDecision: (input) => parseScriptReviewChoiceDecision(input),
    toWorkflowDecision: (decision) => {
      if (decision.choiceType !== 'script_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:script_review:${decision.choiceType}`)
      }
      return { choiceType: 'script_review', decision: decision.decision }
    },
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'script_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:script_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { decision: 'approve' }
        : { decision: 'revise', revisionNotes: decision.revisionNotes }
    },
    isEnabled: (workflow) => workflow.stage === 'script_ready_for_review',
    resolveWorkflowAction: (workflow, decision) => {
      if (decision.choiceType !== 'script_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:script_review:${decision.choiceType}`)
      }
      if (workflow.stage !== 'script_ready_for_review') return null
      return decision.decision === 'approve'
        ? workflowAction('approve_script', 'Approve generated script')
        : workflowAction('revise_script', 'Revise generated script')
    },
    resolveReviewedResource: async (params) => await resolveScriptReviewChoiceResource(params),
  },
  bible_review: {
    choiceType: 'bible_review',
    toolId: 'request_edit_bible_review_choice',
    reviewedResourceKind: 'bible_review_plan',
    offerBuilder: { kind: 'runtime', build: async (params) => await buildBibleReviewChoiceCard(params) },
    parseDecision: (input) => parseBibleReviewChoiceDecision(input),
    toWorkflowDecision: (decision) => {
      if (decision.choiceType !== 'bible_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:bible_review:${decision.choiceType}`)
      }
      return { choiceType: 'bible_review', decision: decision.decision }
    },
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'bible_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:bible_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { decision: 'approve', aspectRatio: decision.aspectRatio }
        : { decision: 'revise', revisionNotes: decision.revisionNotes }
    },
    isEnabled: (workflow) => workflow.stage === 'bible_ready_for_review',
    resolveWorkflowAction: (workflow, decision) => {
      if (decision.choiceType !== 'bible_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:bible_review:${decision.choiceType}`)
      }
      if (workflow.stage !== 'bible_ready_for_review') return null
      return decision.decision === 'approve'
        ? workflowAction('confirm_bible', 'Confirm episode plan')
        : workflowAction('revise_bible', 'Revise episode plan')
    },
    resolveReviewedResource: async (params) => await resolveBibleReviewChoiceResource(params),
  },
  style: {
    choiceType: 'style',
    toolId: 'request_edit_style_choice',
    reviewedResourceKind: 'style_preview_set',
    offerBuilder: { kind: 'runtime', build: async (params) => await buildStyleAndRatioChoiceCard(params) },
    parseDecision: (input) => parseStyleChoiceDecision(input),
    toWorkflowDecision: (decision) => {
      if (decision.choiceType !== 'style') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:style:${decision.choiceType}`)
      }
      return {
        choiceType: 'style',
        decision: decision.decision,
        stylePreviewId: decision.stylePreviewId,
      }
    },
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
    isEnabled: (workflow) => workflow.stage === 'needs_style_choice',
    resolveWorkflowAction: (workflow, decision) => {
      assertDecisionType(decision, 'style')
      return workflow.stage === 'needs_style_choice'
        ? workflowAction('confirm_edit_style_preview', 'Confirm selected visual style')
        : null
    },
    resolveReviewedResource: async (params) => await resolveStyleChoiceResource(params),
  },
  asset_review: {
    choiceType: 'asset_review',
    toolId: 'request_edit_asset_review_choice',
    reviewedResourceKind: 'asset_review_set',
    offerBuilder: { kind: 'runtime', build: async (params) => await buildAssetReviewChoiceCard(params) },
    parseDecision: (input) => parseAssetReviewChoiceDecision(input),
    toWorkflowDecision: (decision) => {
      if (decision.choiceType !== 'asset_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:asset_review:${decision.choiceType}`)
      }
      return { choiceType: 'asset_review', decision: decision.decision }
    },
    serializeDecision: (decision) => {
      if (decision.choiceType !== 'asset_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:asset_review:${decision.choiceType}`)
      }
      return decision.decision === 'approve'
        ? { decision: 'approve' }
        : { decision: 'revise', revisionNotes: decision.revisionNotes }
    },
    isEnabled: (workflow) => workflow.stage === 'assets_ready_for_review',
    resolveWorkflowAction: (workflow, decision) => {
      if (decision.choiceType !== 'asset_review') {
        throw new Error(`EDIT_FIRST_CHOICE_REGISTRY_DECISION_MISMATCH:asset_review:${decision.choiceType}`)
      }
      if (workflow.stage !== 'assets_ready_for_review') return null
      return decision.decision === 'approve'
        ? workflowAction('approve_edit_script_assets', 'Approve required assets')
        : workflowAction('revise_edit_script_assets', 'Revise required assets')
    },
    resolveReviewedResource: async (params) => await resolveAssetReviewChoiceResource(params),
  },
} as const satisfies Record<EditFirstChoiceType, EditFirstChoiceDefinition>

export function getEditFirstChoiceDefinition(
  choiceType: EditFirstChoiceType,
): EditFirstChoiceDefinition {
  return EDIT_FIRST_CHOICE_REGISTRY[choiceType]
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

export function isEditFirstChoiceToolEnabled(params: {
  workflow: EditFirstWorkflowState
  operationId: EditFirstChoiceToolId
}): boolean {
  const definition = EDIT_FIRST_CHOICE_TYPES
    .map((choiceType) => EDIT_FIRST_CHOICE_REGISTRY[choiceType])
    .find((candidate) => candidate.toolId === params.operationId)
  if (!definition) throw new Error(`EDIT_FIRST_CHOICE_TOOL_DEFINITION_MISSING:${params.operationId}`)
  return definition.isEnabled(params.workflow)
}
