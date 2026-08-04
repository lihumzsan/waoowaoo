import type { NextRequest } from 'next/server'

/**
 * Request-shaped inputs both Checkout routes need. Kept in one place so the
 * one-off and subscription routes cannot drift on which origin they send users
 * back to or which language they price in.
 */

export function resolveCheckoutLocale(request: NextRequest): 'zh' | 'en' {
  const language = request.headers.get('accept-language') || ''
  return language.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function resolveCheckoutPublicOrigin(request: NextRequest): string {
  const configured = process.env.PAYMENT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim()
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PAYMENT_PUBLIC_BASE_URL_REQUIRED')
  }
  return request.nextUrl.origin
}
