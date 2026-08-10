import type { TemporalWorkflowType } from '../workflow-registry'
import { operationExecutionWorkflow } from './operation-execution'
import { taskWorkflow } from './task'
import { userTaskSchedulerWorkflow } from './user-task-scheduler'

export type TemporalWorkflowImplementation = (...args: never[]) => Promise<unknown>

export const temporalWorkflowImplementations = {
  operationExecutionWorkflow,
  taskWorkflow,
  userTaskSchedulerWorkflow,
} satisfies Record<TemporalWorkflowType, TemporalWorkflowImplementation>

export { operationExecutionWorkflow, taskWorkflow, userTaskSchedulerWorkflow }
