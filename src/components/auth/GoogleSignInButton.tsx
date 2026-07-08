'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { getPathname } from '@/i18n/navigation'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'

interface GoogleSignInButtonProps {
  label: string
  loadingLabel: string
  onError: () => void
}

export default function GoogleSignInButton({
  label,
  loadingLabel,
  onError,
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false)
  const locale = useLocale()

  const handleClick = async () => {
    setLoading(true)
    try {
      const callbackUrl = getPathname({
        locale,
        href: buildAuthenticatedHomeTarget(),
      })
      await signIn('google', { callbackUrl })
    } catch {
      setLoading(false)
      onError()
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={handleClick}
      className="glass-btn-base glass-btn-secondary w-full py-3 px-4 font-semibold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
    >
      <AppIcon name="chrome" className="h-5 w-5" aria-hidden="true" />
      <span>{loading ? loadingLabel : label}</span>
    </button>
  )
}
