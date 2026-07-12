'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { OperationPlanView } from '@/lib/operations/planning'
import type { WorkspaceCanvasBillableActionRequest } from './hooks/useWorkspaceCanvasBillableAction'

export interface WorkspaceCanvasBillableExecution {
  readonly request: WorkspaceCanvasBillableActionRequest
  readonly plan: OperationPlanView
  readonly nodeId: string
}

interface WorkspaceCanvasBillingContextValue {
  readonly projectId: string
  readonly episodeId: string
  execute(input: WorkspaceCanvasBillableExecution): Promise<void>
}

const WorkspaceCanvasBillingContext = createContext<WorkspaceCanvasBillingContextValue | null>(null)

export function WorkspaceCanvasBillingProvider({
  value,
  children,
}: {
  readonly value: WorkspaceCanvasBillingContextValue
  readonly children: ReactNode
}) {
  return (
    <WorkspaceCanvasBillingContext.Provider value={value}>
      {children}
    </WorkspaceCanvasBillingContext.Provider>
  )
}

export function useWorkspaceCanvasBilling(): WorkspaceCanvasBillingContextValue {
  const value = useContext(WorkspaceCanvasBillingContext)
  if (!value) throw new Error('WORKSPACE_CANVAS_BILLING_CONTEXT_REQUIRED')
  return value
}
