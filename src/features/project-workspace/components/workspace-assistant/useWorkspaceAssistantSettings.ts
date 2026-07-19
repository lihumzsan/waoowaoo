'use client'

import { useCallback, useEffect, useState } from 'react'

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
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/user-preference', { cache: 'no-store' })
      if (!response.ok) throw new Error(`ASSISTANT_SETTINGS_LOAD_FAILED:${response.status}`)
      setBillingConfirmationRequired(readBillingConfirmationRequired(await response.json()))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateBillingConfirmationRequired = useCallback(async (required: boolean) => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/user-preference', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assistantBillingConfirmationRequired: required }),
      })
      if (!response.ok) throw new Error(`ASSISTANT_SETTINGS_SAVE_FAILED:${response.status}`)
      setBillingConfirmationRequired(readBillingConfirmationRequired(await response.json()))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
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
