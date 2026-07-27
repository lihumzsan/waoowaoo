import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  buildProjectAssistantScopeRef,
  replaceProjectAssistantThreadPlanInTransaction,
} from './persistence'
import type { ProjectAssistantId } from './types'

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

const projectAgentPlanItemsSchema = z.array(z.object({
  step: z.string().trim().min(1).max(160),
  status: z.enum(PROJECT_AGENT_PLAN_STATUSES),
}).strict()).max(12).superRefine((items, context) => {
  const inProgressCount = items.filter((item) => item.status === 'in_progress').length
  if (inProgressCount > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PROJECT_AGENT_PLAN_MULTIPLE_IN_PROGRESS',
    })
  }
})

export const projectAgentPlanInputSchema = z.object({
  explanation: z.string().trim().min(1).max(500).nullable(),
  plan: projectAgentPlanItemsSchema,
}).strict()

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

interface ProjectAgentPlanIdentity {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId: ProjectAssistantId
}

type ProjectAgentPlanReader = Pick<PrismaClient, 'projectAssistantThread'>

function normalizeProjectAgentPlanSnapshot(
  input: z.infer<typeof projectAgentPlanInputSchema>,
): ProjectAgentPlanSnapshot {
  const shouldClear = input.plan.length === 0
    || input.plan.every((item) => item.status === 'completed')
  return projectAgentPlanSnapshotSchema.parse({
    explanation: shouldClear ? null : input.explanation,
    plan: shouldClear ? [] : input.plan,
  })
}

export function createProjectAgentPlanSnapshot(input: unknown): ProjectAgentPlanSnapshot {
  return normalizeProjectAgentPlanSnapshot(projectAgentPlanInputSchema.parse(input))
}

export function parseProjectAgentPlanSnapshot(value: unknown): ProjectAgentPlanSnapshot | null {
  if (value === null || value === undefined) return null
  const snapshot = normalizeProjectAgentPlanSnapshot(projectAgentPlanInputSchema.parse(value))
  return snapshot.plan.length === 0 ? null : snapshot
}

export async function readProjectAgentPlan(
  input: ProjectAgentPlanIdentity,
  reader: ProjectAgentPlanReader = prisma,
): Promise<ProjectAgentPlanSnapshot | null> {
  const record = await reader.projectAssistantThread.findUnique({
    where: {
      projectId_userId_assistantId_scopeRef: {
        projectId: input.projectId,
        userId: input.userId,
        assistantId: input.assistantId,
        scopeRef: buildProjectAssistantScopeRef(input),
      },
    },
    select: { planJson: true },
  })
  return parseProjectAgentPlanSnapshot(record?.planJson)
}

export async function replaceProjectAgentPlanInTransaction(
  transaction: Prisma.TransactionClient,
  input: ProjectAgentPlanIdentity,
  snapshot: ProjectAgentPlanSnapshot,
): Promise<void> {
  await replaceProjectAssistantThreadPlanInTransaction(transaction, {
    ...input,
    planJson: snapshot.plan.length === 0
      ? Prisma.DbNull
      : JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
  })
}
