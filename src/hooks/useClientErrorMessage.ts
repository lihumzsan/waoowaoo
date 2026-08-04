'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { resolveClientErrorMessage } from '@/lib/errors/client'

export function useClientErrorMessage(): (error: unknown, fallback: string) => string {
  const t = useTranslations('errors')
  return useCallback(
    (error: unknown, fallback: string) => resolveClientErrorMessage(
      error,
      (code) => t.has(code) ? t(code) : null,
      fallback,
    ).message,
    [t],
  )
}
