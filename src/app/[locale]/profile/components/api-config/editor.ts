'use client'

import { apiFetch } from '@/lib/api-fetch'
import type { CapabilitySelections } from '@/lib/ai-registry/types'
import type { CustomModel, Provider } from './types'
import type { DefaultModels, WorkflowConcurrency } from './selectors'
import type { MutableRefObject } from 'react'
import { useCallback, useRef, useState } from 'react'
import { logError as _ulogError } from '@/lib/logging/core'
import { capabilitySelectionsToCommand } from '@/lib/ai-registry/capability-selection-command'

export interface ApiConfigSaveError {
  code: string
  providerId?: string
  requestId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function readSaveError(response: Response, providers: Provider[]): Promise<ApiConfigSaveError> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { code: 'REQUEST_FAILED' }
  }

  if (!isRecord(payload)) return { code: 'REQUEST_FAILED' }
  const nestedError = isRecord(payload.error) ? payload.error : null
  const details = nestedError && isRecord(nestedError.details) ? nestedError.details : null
  const code = readString(details?.code)
    || readString(payload.code)
    || readString(nestedError?.code)
    || 'REQUEST_FAILED'
  const field = readString(details?.field) || readString(payload.field)
  const providerIndexMatch = /^providers\[(\d+)]\.id$/.exec(field)
  const providerIndex = providerIndexMatch ? Number.parseInt(providerIndexMatch[1], 10) : -1
  const providerId = providerIndex >= 0 ? providers[providerIndex]?.id : undefined
  const requestId = readString(payload.requestId) || readString(details?.requestId)

  return {
    code,
    ...(providerId ? { providerId } : {}),
    ...(requestId ? { requestId } : {}),
  }
}

export function useApiConfigSaver(input: {
  latestModelsRef: MutableRefObject<CustomModel[]>
  latestProvidersRef: MutableRefObject<Provider[]>
  latestDefaultModelsRef: MutableRefObject<DefaultModels>
  latestWorkflowConcurrencyRef: MutableRefObject<WorkflowConcurrency>
  latestCapabilityDefaultsRef: MutableRefObject<CapabilitySelections>
}): {
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  saveError: ApiConfigSaveError | null
  performSave: (overrides?: {
    defaultModels?: DefaultModels
    workflowConcurrency?: WorkflowConcurrency
    capabilityDefaults?: CapabilitySelections
  }, silent?: boolean) => Promise<boolean>
  flushConfig: () => Promise<void>
} {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<ApiConfigSaveError | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const performSave = useCallback(async (
    overrides?: {
      defaultModels?: DefaultModels
      workflowConcurrency?: WorkflowConcurrency
      capabilityDefaults?: CapabilitySelections
    },
    silent = false,
  ): Promise<boolean> => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (!silent) {
      setSaveStatus('saving')
      setSaveError(null)
    }

    try {
      const currentModels = input.latestModelsRef.current
      const currentProviders = input.latestProvidersRef.current
      const currentDefaultModels = overrides?.defaultModels ?? input.latestDefaultModelsRef.current
      const currentWorkflowConcurrency = overrides?.workflowConcurrency ?? input.latestWorkflowConcurrencyRef.current
      const currentCapabilityDefaults = overrides?.capabilityDefaults ?? input.latestCapabilityDefaultsRef.current
      const enabledModels = currentModels.filter((model) => model.enabled)

      const res = await apiFetch('/api/user/api-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          models: enabledModels.map((model) => ({
            modelId: model.modelId,
            name: model.name,
            type: model.type,
            provider: model.provider,
          })),
          providers: currentProviders.map((provider) => ({
            id: provider.id,
            name: provider.name,
            ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
            ...(provider.apiKey !== undefined ? { apiKey: provider.apiKey } : {}),
            ...(provider.hidden !== undefined ? { hidden: provider.hidden } : {}),
          })),
          defaultModels: currentDefaultModels,
          workflowConcurrency: currentWorkflowConcurrency,
          capabilityDefaults: capabilitySelectionsToCommand(currentCapabilityDefaults),
        }),
      })
      if (!res.ok) {
        if (!silent) {
          setSaveError(await readSaveError(res, currentProviders))
          setSaveStatus('error')
        }
        return false
      }

      if (!silent) {
        setSaveError(null)
        setSaveStatus('saved')
        saveTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
      }
      return true
    } catch (error) {
      _ulogError('保存失败:', error)
      if (!silent) {
        setSaveError({ code: 'NETWORK_ERROR' })
        setSaveStatus('error')
      }
      return false
    }
  }, [input.latestCapabilityDefaultsRef, input.latestDefaultModelsRef, input.latestModelsRef, input.latestProvidersRef, input.latestWorkflowConcurrencyRef])

  const flushConfig = useCallback(async () => {
    const success = await performSave(undefined, true)
    if (!success) {
      throw new Error('API_CONFIG_FLUSH_FAILED')
    }
  }, [performSave])

  return { saveStatus, saveError, performSave, flushConfig }
}
