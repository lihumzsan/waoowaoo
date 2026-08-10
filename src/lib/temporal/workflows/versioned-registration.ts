import { setWorkflowOptions } from '@temporalio/workflow'
import { TEMPORAL_WORKFLOW } from '../workflow-registry'
import {
  temporalWorkflowImplementations,
  type TemporalWorkflowImplementation,
} from './implementations'

for (const definition of Object.values(TEMPORAL_WORKFLOW)) {
  const implementation: TemporalWorkflowImplementation =
    temporalWorkflowImplementations[definition.type]
  setWorkflowOptions(
    { versioningBehavior: definition.versioningBehavior },
    implementation,
  )
}
