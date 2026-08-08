import {
  VersioningBehavior,
  type VersioningBehavior as TemporalVersioningBehavior,
} from '@temporalio/common'

type TemporalWorkflowDefinition =
  | {
      type: string
      lifecycle: 'bounded'
      versioningBehavior: typeof VersioningBehavior.PINNED
    }
  | {
      type: string
      lifecycle: 'continuous'
      versioningBehavior: typeof VersioningBehavior.AUTO_UPGRADE
    }

/**
 * The exhaustive owner of Temporal Workflow identity, lifetime, and routing policy.
 *
 * Bounded Workflows stay on the code that began their execution. Continuous
 * Workflows follow the deployment's Current Version so an old Worker can drain.
 */
export const TEMPORAL_WORKFLOW = {
  OPERATION_EXECUTION: {
    type: 'operationExecutionWorkflow',
    lifecycle: 'bounded',
    versioningBehavior: VersioningBehavior.PINNED,
  },
  TASK: {
    type: 'taskWorkflow',
    lifecycle: 'bounded',
    versioningBehavior: VersioningBehavior.PINNED,
  },
  USER_TASK_SCHEDULER: {
    type: 'userTaskSchedulerWorkflow',
    lifecycle: 'continuous',
    versioningBehavior: VersioningBehavior.AUTO_UPGRADE,
  },
} as const satisfies Record<string, TemporalWorkflowDefinition>

export type TemporalWorkflowType =
  (typeof TEMPORAL_WORKFLOW)[keyof typeof TEMPORAL_WORKFLOW]['type']

// A Workflow omitted from the registry must fail safe on one build rather than
// silently move across potentially incompatible code. Registry conformance is
// what prevents this fallback from becoming a second policy source.
export const UNREGISTERED_WORKFLOW_VERSIONING_FALLBACK: TemporalVersioningBehavior =
  VersioningBehavior.PINNED
