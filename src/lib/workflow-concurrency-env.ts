import {
  DEFAULT_WORKFLOW_CONCURRENCY_CONFIG,
  type WorkflowConcurrencyConfig,
} from '@/lib/workflow-concurrency'

const ENV_KEYS = {
  analysis: 'DEFAULT_WORKFLOW_CONCURRENCY_ANALYSIS',
  image: 'DEFAULT_WORKFLOW_CONCURRENCY_IMAGE',
  video: 'DEFAULT_WORKFLOW_CONCURRENCY_VIDEO',
} as const satisfies Record<keyof WorkflowConcurrencyConfig, string>

type WorkflowConcurrencyEnv = Record<string, string | undefined>

function readPositiveIntegerEnv(
  key: string,
  fallback: number,
  env: WorkflowConcurrencyEnv,
): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key}_INVALID: ${raw}`)
  }

  return parsed
}

export function getDefaultWorkflowConcurrencyConfig(
  env: WorkflowConcurrencyEnv = process.env,
): WorkflowConcurrencyConfig {
  return {
    analysis: readPositiveIntegerEnv(
      ENV_KEYS.analysis,
      DEFAULT_WORKFLOW_CONCURRENCY_CONFIG.analysis,
      env,
    ),
    image: readPositiveIntegerEnv(
      ENV_KEYS.image,
      DEFAULT_WORKFLOW_CONCURRENCY_CONFIG.image,
      env,
    ),
    video: readPositiveIntegerEnv(
      ENV_KEYS.video,
      DEFAULT_WORKFLOW_CONCURRENCY_CONFIG.video,
      env,
    ),
  }
}
