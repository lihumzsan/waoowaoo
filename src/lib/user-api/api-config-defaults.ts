import { ApiError } from '@/lib/api-errors'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import {
  DEFAULT_ANALYSIS_WORKFLOW_CONCURRENCY,
  DEFAULT_IMAGE_WORKFLOW_CONCURRENCY,
  DEFAULT_VIDEO_WORKFLOW_CONCURRENCY,
  normalizeWorkflowConcurrencyValue,
} from '@/lib/workflow-concurrency'
import type { DefaultModelField, DefaultModelsPayload, StoredModel, WorkflowConcurrencyPayload } from './api-config-types'
import { DEFAULT_MODEL_FIELDS } from './api-config-types'
import { isRecord, readTrimmedString } from './api-config-shared'

const DEFAULT_FIELD_TO_MODEL_TYPE: Readonly<Record<DefaultModelField, StoredModel['type']>> = {
  assistantModel: 'llm',
  analysisModel: 'llm',
  characterModel: 'image',
  locationModel: 'image',
  editModel: 'image',
  videoModel: 'video',
  musicModel: 'music',
  soundModel: 'sound',
}

function validateDefaultModelKey(field: DefaultModelField, value: unknown): string | null {
  // Contract anchor: default model key must be provider::modelId
  if (value === undefined) return null
  const modelKey = readTrimmedString(value)
  if (!modelKey) return null
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: `defaultModels.${field}`,
    })
  }
  return parsed.modelKey
}

export function normalizeDefaultModelsInput(rawDefaultModels: unknown): DefaultModelsPayload {
  if (rawDefaultModels === undefined) return {}
  if (!isRecord(rawDefaultModels)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DEFAULT_MODELS_INVALID',
      field: 'defaultModels',
    })
  }

  const normalized: DefaultModelsPayload = {}
  for (const field of DEFAULT_MODEL_FIELDS) {
    if (rawDefaultModels[field] !== undefined) {
      normalized[field] = validateDefaultModelKey(field, rawDefaultModels[field]) || ''
    }
  }

  return normalized
}

export function normalizeWorkflowConcurrencyInput(rawWorkflowConcurrency: unknown): WorkflowConcurrencyPayload {
  if (rawWorkflowConcurrency === undefined) return {}
  if (!isRecord(rawWorkflowConcurrency)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_PARAMS',
      field: 'workflowConcurrency',
    })
  }

  const normalized: WorkflowConcurrencyPayload = {}

  if (rawWorkflowConcurrency.analysis !== undefined) {
    const value = normalizeWorkflowConcurrencyValue(
      rawWorkflowConcurrency.analysis,
      DEFAULT_ANALYSIS_WORKFLOW_CONCURRENCY,
    )
    if (value !== rawWorkflowConcurrency.analysis) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'INVALID_PARAMS',
        field: 'workflowConcurrency.analysis',
      })
    }
    normalized.analysis = value
  }

  if (rawWorkflowConcurrency.image !== undefined) {
    const value = normalizeWorkflowConcurrencyValue(
      rawWorkflowConcurrency.image,
      DEFAULT_IMAGE_WORKFLOW_CONCURRENCY,
    )
    if (value !== rawWorkflowConcurrency.image) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'INVALID_PARAMS',
        field: 'workflowConcurrency.image',
      })
    }
    normalized.image = value
  }

  if (rawWorkflowConcurrency.video !== undefined) {
    const value = normalizeWorkflowConcurrencyValue(
      rawWorkflowConcurrency.video,
      DEFAULT_VIDEO_WORKFLOW_CONCURRENCY,
    )
    if (value !== rawWorkflowConcurrency.video) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'INVALID_PARAMS',
        field: 'workflowConcurrency.video',
      })
    }
    normalized.video = value
  }

  return normalized
}

function hasCandidateModelsForField(field: DefaultModelField, models: StoredModel[]): boolean {
  const expectedType = DEFAULT_FIELD_TO_MODEL_TYPE[field]
  return models.some((model) => model.type === expectedType)
}

function isEnabledDefaultModel(field: DefaultModelField, modelKey: string, models: StoredModel[]): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) return false
  const expectedType = DEFAULT_FIELD_TO_MODEL_TYPE[field]
  return models.some((model) => model.type === expectedType && model.modelKey === parsed.modelKey)
}

export function sanitizeDefaultModelsAgainstModels(
  defaultModels: DefaultModelsPayload,
  models: StoredModel[],
): DefaultModelsPayload {
  const sanitized: DefaultModelsPayload = {}

  for (const field of DEFAULT_MODEL_FIELDS) {
    const rawModelKey = defaultModels[field]
    if (rawModelKey === undefined) continue
    const modelKey = readTrimmedString(rawModelKey)
    if (!modelKey) {
      sanitized[field] = ''
      continue
    }
    if (!hasCandidateModelsForField(field, models)) {
      sanitized[field] = modelKey
      continue
    }
    sanitized[field] = isEnabledDefaultModel(field, modelKey, models) ? modelKey : ''
  }

  return sanitized
}

export function validateDefaultModelsAgainstModels(
  defaultModels: DefaultModelsPayload,
  models: StoredModel[],
) {
  for (const field of DEFAULT_MODEL_FIELDS) {
    const modelKey = readTrimmedString(defaultModels[field])
    if (!modelKey) continue
    if (!hasCandidateModelsForField(field, models)) continue
    if (isEnabledDefaultModel(field, modelKey, models)) continue

    throw new ApiError('INVALID_PARAMS', {
      code: 'DEFAULT_MODEL_NOT_ENABLED',
      field: `defaultModels.${field}`,
      modelKey,
      expectedType: DEFAULT_FIELD_TO_MODEL_TYPE[field],
    })
  }
}
