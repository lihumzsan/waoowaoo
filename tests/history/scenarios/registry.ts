import type { HistoricalRegressionScenario } from '../../harness/historical-regression'
import { ASSISTANT_RUN_HISTORICAL_SCENARIOS } from './assistant-run-scenarios'
import { CANVAS_LIFECYCLE_HISTORICAL_SCENARIOS } from './canvas-lifecycle-scenarios'
import { PROVIDER_HISTORICAL_SCENARIOS } from './provider-scenarios'
import { TASK_LIFECYCLE_HISTORICAL_SCENARIOS } from './task-lifecycle-scenarios'

export const HISTORICAL_SCENARIO_REGISTRY: readonly HistoricalRegressionScenario[] = [
  ...ASSISTANT_RUN_HISTORICAL_SCENARIOS,
  ...TASK_LIFECYCLE_HISTORICAL_SCENARIOS,
  ...CANVAS_LIFECYCLE_HISTORICAL_SCENARIOS,
  ...PROVIDER_HISTORICAL_SCENARIOS,
]
