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
