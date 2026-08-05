'use client'

import { useState } from 'react'

/**
 * A cited site's own icon.
 *
 * The icon is fetched straight from the source domain rather than through a
 * favicon service, because a service would learn every page the user reads and
 * the source domain is one they are about to visit anyway. Plenty of sites do
 * not serve `/favicon.ico`, so a failure is expected rather than exceptional
 * and falls back to a monogram tile — a broken image would look like a bug,
 * while a lettered tile reads as the site's mark.
 */

const MONOGRAM_TONES = [
  'bg-[#eef2ff] text-[#4f46e5]',
  'bg-[#ecfdf5] text-[#059669]',
  'bg-[#fff7ed] text-[#c2410c]',
  'bg-[#fdf2f8] text-[#be185d]',
  'bg-[#eff6ff] text-[#1d4ed8]',
  'bg-[#f5f3ff] text-[#7c3aed]',
] as const

/** Stable per-domain tone, so the same source keeps the same mark everywhere. */
function monogramTone(domain: string): string {
  let hash = 0
  for (let index = 0; index < domain.length; index += 1) {
    hash = (hash * 31 + domain.charCodeAt(index)) % 100_000
  }
  return MONOGRAM_TONES[hash % MONOGRAM_TONES.length]
}

function monogramLabel(domain: string): string {
  const first = domain.replace(/^www\./, '').charAt(0)
  return first ? first.toUpperCase() : '·'
}

export function WebSourceFavicon({
  domain,
  className = 'h-4 w-4',
}: {
  readonly domain: string
  readonly className?: string
}) {
  const [failed, setFailed] = useState(false)
  const shared = `${className} shrink-0 rounded-[4px] object-contain`

  if (failed || !domain) {
    return (
      <span
        aria-hidden="true"
        className={`${shared} flex items-center justify-center text-[0.6em] font-semibold leading-none ${monogramTone(domain)}`}
      >
        {monogramLabel(domain)}
      </span>
    )
  }

  return (
    // A public site icon, never a workspace asset, so it does not cross the
    // owned-media boundary.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://${domain}/favicon.ico`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${shared} bg-white`}
    />
  )
}

export function readSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
