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
}).strict()

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
  return projectAgentPlanSnapshotSchema.parse({
    explanation: input.plan.length === 0 ? null : input.explanation,
    plan: input.plan,
  })
}

export function createProjectAgentPlanSnapshot(input: unknown): ProjectAgentPlanSnapshot {
  return normalizeProjectAgentPlanSnapshot(projectAgentPlanInputSchema.parse(input))
}

export function parseProjectAgentPlanSnapshot(value: unknown): ProjectAgentPlanSnapshot | null {
  if (value === null || value === undefined) return null
  return projectAgentPlanSnapshotSchema.parse(value)
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
