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
      className="w-full rounded-xl bg-[#4285F4] px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-[#3367D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4285F4] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center justify-center gap-2"
    >
      <AppIcon name="chrome" className="h-5 w-5 text-white" aria-hidden="true" />
      <span>{loading ? loadingLabel : label}</span>
    </button>
  )
}
