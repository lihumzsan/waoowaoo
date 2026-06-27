import { ARTIFACT_TYPES } from '@/lib/artifact-system/types'
import type {
  CommandEnvelope,
  CommandOperationDefinition,
  CommandOperationId,
  ExecutionPlanDraft,
  PlanStep,
} from './types'

const COMMAND_OPERATIONS: Record<CommandOperationId, CommandOperationDefinition> = {
  insert_panel: {
    id: 'insert_panel',
    name: 'Insert Panel',
    summary: 'Insert a new storyboard panel into an existing panel sequence.',
    riskLevel: 'medium',
    requiresApproval: true,
    inputArtifacts: [ARTIFACT_TYPES.STORYBOARD_PANEL_SET],
    outputArtifacts: [ARTIFACT_TYPES.STORYBOARD_PANEL_SET, ARTIFACT_TYPES.PANEL_PROMPT],
    invalidates: [ARTIFACT_TYPES.PANEL_IMAGE, ARTIFACT_TYPES.PANEL_VIDEO],
    mutationKind: 'generate',
  },
  panel_variant: {
    id: 'panel_variant',
    name: 'Panel Variant',
    summary: 'Generate a new image variant for an existing storyboard panel.',
    riskLevel: 'low',
    requiresApproval: false,
    inputArtifacts: [ARTIFACT_TYPES.PANEL_IMAGE],
    outputArtifacts: [ARTIFACT_TYPES.PANEL_IMAGE],
    invalidates: [ARTIFACT_TYPES.PANEL_VIDEO],
    mutationKind: 'generate',
  },
  modify_shot_prompt: {
    id: 'modify_shot_prompt',
    name: 'Modify Shot Prompt',
    summary: 'Modify the prompt attached to a storyboard panel shot.',
    riskLevel: 'medium',
    requiresApproval: false,
    inputArtifacts: [ARTIFACT_TYPES.PANEL_PROMPT],
    outputArtifacts: [ARTIFACT_TYPES.PANEL_PROMPT],
    invalidates: [ARTIFACT_TYPES.PANEL_IMAGE, ARTIFACT_TYPES.PANEL_VIDEO],
    mutationKind: 'update',
  },
}

function getPlanOperationDefinition(operationId: CommandOperationId): CommandOperationDefinition {
  return COMMAND_OPERATIONS[operationId]
}

function buildPlanStep(operationId: CommandOperationId, orderIndex: number, dependsOn: string[]): PlanStep {
  const operation = getPlanOperationDefinition(operationId)
  return {
    stepKey: operation.id,
    operationId: operation.id,
    title: operation.name,
    orderIndex,
    inputArtifacts: operation.inputArtifacts,
    outputArtifacts: operation.outputArtifacts,
    invalidates: operation.invalidates,
    mutationKind: operation.mutationKind,
    riskLevel: operation.riskLevel,
    requiresApproval: operation.requiresApproval,
    dependsOn,
  }
}

export function buildExecutionPlanDraft(command: CommandEnvelope): ExecutionPlanDraft {
  const step = buildPlanStep(command.operationId, 0, [])
  return {
    summary: getPlanOperationDefinition(command.operationId).summary,
    requiresApproval: step.requiresApproval,
    riskSummary: {
      highestRiskLevel: step.riskLevel,
      reasons: step.invalidates.map((artifactType) => `${step.operationId} invalidates ${artifactType}`),
    },
    steps: [step],
  }
}
