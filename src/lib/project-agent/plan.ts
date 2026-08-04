import { z } from 'zod'

export const PROJECT_AGENT_PLAN_STATUSES = [
  'pending',
  'in_progress',
  'completed',
] as const

export type ProjectAgentPlanStatus = (typeof PROJECT_AGENT_PLAN_STATUSES)[number]

export interface ProjectAgentPlanItem {
  step: string
  status: ProjectAgentPlanStatus
}

export interface ProjectAgentPlanSnapshot {
  explanation: string | null
  plan: ProjectAgentPlanItem[]
}

const projectAgentPlanStepSchema = z.string().trim().min(1).max(160)

const projectAgentPlanItemSchema = z.object({
  step: z.string().trim().min(1).max(160),
  status: z.enum(PROJECT_AGENT_PLAN_STATUSES),
}).strict()

const projectAgentPlanItemsSchema = z.array(projectAgentPlanItemSchema).max(25).superRefine((items, context) => {
  const inProgressCount = items.filter((item) => item.status === 'in_progress').length
  if (inProgressCount > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PROJECT_AGENT_PLAN_MULTIPLE_IN_PROGRESS',
    })
  }
})

const projectAgentPlanAuthoringSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('active'),
    completed: z.array(projectAgentPlanStepSchema).max(12)
      .describe('Completed steps, in display order.'),
    active: projectAgentPlanStepSchema
      .describe('The single step currently in progress.'),
    pending: z.array(projectAgentPlanStepSchema).max(12)
      .describe('Pending steps, in display order.'),
  }).strict()
    .describe('An open plan with exactly one active step.'),
  z.object({
    state: z.literal('pending'),
    completed: z.array(projectAgentPlanStepSchema).max(12)
      .describe('Completed steps, in display order.'),
    pending: z.array(projectAgentPlanStepSchema).min(1).max(12)
      .describe('One or more pending steps, in display order.'),
  }).strict()
    .describe('An open plan with pending work and no active step.'),
  z.object({
    state: z.literal('completed'),
    completed: z.array(projectAgentPlanStepSchema).min(1).max(12)
      .describe('The completed steps. The server closes the plan instead of persisting them.'),
  }).strict()
    .describe('Close the current plan because every step is completed.'),
  z.object({
    state: z.literal('clear'),
  }).strict()
    .describe('Explicitly close and clear the current plan.'),
]).describe('Choose exactly one complete plan state. The structure makes more than one active step impossible.')

export const projectAgentPlanInputSchema = z.object({
  explanation: z.string().trim().min(1).max(500).nullable(),
  plan: projectAgentPlanAuthoringSchema,
}).strict().describe('Replace the current advisory work plan. This notebook never executes work or controls project state.')

export const projectAgentPlanSnapshotSchema = z.object({
  explanation: z.string().trim().min(1).max(500).nullable(),
  plan: projectAgentPlanItemsSchema,
}).strict().superRefine((snapshot, context) => {
  if (
    snapshot.plan.length > 0
    && snapshot.plan.every((item) => item.status === 'completed')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PROJECT_AGENT_PLAN_COMPLETED_SNAPSHOT_MUST_BE_CLEARED',
    })
  }
})

function normalizeProjectAgentPlanSnapshot(
  input: z.infer<typeof projectAgentPlanInputSchema>,
): ProjectAgentPlanSnapshot {
  const plan = input.plan.state === 'active'
    ? [
        ...input.plan.completed.map((step) => ({ step, status: 'completed' as const })),
        { step: input.plan.active, status: 'in_progress' as const },
        ...input.plan.pending.map((step) => ({ step, status: 'pending' as const })),
      ]
    : input.plan.state === 'pending'
      ? [
          ...input.plan.completed.map((step) => ({ step, status: 'completed' as const })),
          ...input.plan.pending.map((step) => ({ step, status: 'pending' as const })),
        ]
      : []
  const shouldClear = input.plan.state === 'clear'
    || input.plan.state === 'completed'
  return projectAgentPlanSnapshotSchema.parse({
    explanation: shouldClear ? null : input.explanation,
    plan: shouldClear ? [] : plan,
  })
}

export function createProjectAgentPlanSnapshot(input: unknown): ProjectAgentPlanSnapshot {
  return normalizeProjectAgentPlanSnapshot(projectAgentPlanInputSchema.parse(input))
}

export function parseProjectAgentPlanSnapshot(value: unknown): ProjectAgentPlanSnapshot | null {
  if (value === null || value === undefined) return null
  const stored = z.object({
    explanation: z.string().trim().min(1).max(500).nullable(),
    plan: projectAgentPlanItemsSchema,
  }).strict().parse(value)
  if (stored.plan.length === 0 || stored.plan.every((item) => item.status === 'completed')) {
    return null
  }
  return projectAgentPlanSnapshotSchema.parse(stored)
}
