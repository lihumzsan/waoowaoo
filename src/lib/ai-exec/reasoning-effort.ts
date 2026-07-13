import {
  getProjectModelConfig,
  getUserModelConfig,
  resolveModelCapabilityGenerationOptions,
} from '@/lib/config-service'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import {
  DEFAULT_REASONING_EFFORT,
  parseReasoningEffort,
  type ReasoningEffort,
} from '@/lib/ai-registry/reasoning-effort'
import type { CapabilitySelections } from '@/lib/ai-registry/types'

export type ReasoningEffortPurpose = 'analysis' | 'assistant'

const PLATFORM_REASONING_EFFORT_ENV: Record<ReasoningEffortPurpose, string> = {
  analysis: 'PLATFORM_DEFAULT_ANALYSIS_REASONING_EFFORT',
  assistant: 'PLATFORM_DEFAULT_ASSISTANT_REASONING_EFFORT',
}

function readPlatformReasoningEffort(purpose: ReasoningEffortPurpose): ReasoningEffort {
  const envName = PLATFORM_REASONING_EFFORT_ENV[purpose]
  const raw = process.env[envName]?.trim()
  return raw
    ? parseReasoningEffort(raw, envName)
    : DEFAULT_REASONING_EFFORT
}

export async function resolveReasoningEffort(input: {
  userId: string
  modelKey: string
  purpose: ReasoningEffortPurpose
  projectId?: string
  explicit?: unknown
}): Promise<ReasoningEffort> {
  ensureAiCatalogsRegistered()

  let candidate: ReasoningEffort
  let capabilityDefaults: CapabilitySelections | undefined
  let capabilityOverrides: CapabilitySelections | undefined

  if (input.explicit !== undefined) {
    candidate = parseReasoningEffort(input.explicit, `${input.purpose}:runtime`)
  } else if (isPlatformProviderCredentialMode()) {
    candidate = readPlatformReasoningEffort(input.purpose)
  } else {
    const config = input.purpose === 'analysis' && input.projectId
      ? await getProjectModelConfig(input.projectId, input.userId)
      : await getUserModelConfig(input.userId)
    capabilityDefaults = config.capabilityDefaults
    capabilityOverrides = 'capabilityOverrides' in config
      ? config.capabilityOverrides
      : undefined
    const configured = resolveModelCapabilityGenerationOptions({
      modelType: 'llm',
      modelKey: input.modelKey,
      capabilityDefaults,
      capabilityOverrides,
    }).reasoningEffort
    candidate = configured === undefined
      ? DEFAULT_REASONING_EFFORT
      : parseReasoningEffort(configured, `${input.purpose}:configured`)
  }

  const validated = resolveModelCapabilityGenerationOptions({
    modelType: 'llm',
    modelKey: input.modelKey,
    capabilityDefaults,
    capabilityOverrides,
    runtimeSelections: { reasoningEffort: candidate },
  }).reasoningEffort

  return parseReasoningEffort(validated, `${input.purpose}:${input.modelKey}`)
}
