'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readBillingConfirmationRequired(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.preference)) {
    throw new Error('ASSISTANT_SETTINGS_RESPONSE_INVALID')
  }
  const setting = value.preference.assistantBillingConfirmationRequired
  if (typeof setting !== 'boolean') {
    throw new Error('ASSISTANT_SETTINGS_BILLING_CONFIRMATION_INVALID')
  }
  return setting
}

export function useWorkspaceAssistantSettings() {
  const [billingConfirmationRequired, setBillingConfirmationRequired] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      const response = await apiFetch('/api/user-preference', { cache: 'no-store' })
      if (!response.ok) throw await readClientApiError(response)
      setBillingConfirmationRequired(readBillingConfirmationRequired(await response.json()))
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateBillingConfirmationRequired = useCallback(async (required: boolean) => {
    if (saving) return
    setSaving(true)
    setError(false)
    try {
      const response = await apiFetch('/api/user-preference', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assistantBillingConfirmationRequired: required }),
      })
      if (!response.ok) throw await readClientApiError(response)
      setBillingConfirmationRequired(readBillingConfirmationRequired(await response.json()))
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }, [saving])

  return {
    billingConfirmationRequired,
    saving,
    error,
    reload: load,
    updateBillingConfirmationRequired,
  }
}
