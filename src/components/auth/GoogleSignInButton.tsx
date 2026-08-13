'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { GoogleLogoIcon } from '@/components/ui/icons'
import { getPathname } from '@/i18n/navigation'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'

interface GoogleSignInButtonProps {
  label: string
  loadingLabel: string
  onError: () => void
  postAuthTarget: string | null
}

export default function GoogleSignInButton({
  label,
  loadingLabel,
  onError,
  postAuthTarget,
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false)
  const locale = useLocale()

  const handleClick = async () => {
    setLoading(true)
    try {
      const callbackUrl = postAuthTarget ?? getPathname({ locale, href: buildAuthenticatedHomeTarget() })
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
      className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-[#747775] bg-white px-4 text-sm font-medium text-[#1f1f1f] transition hover:bg-[#f8fafd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GoogleLogoIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span>{loading ? loadingLabel : label}</span>
    </button>
  )
}
