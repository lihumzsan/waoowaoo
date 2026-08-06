import { getPublicBaseUrl } from '@/lib/env'

export function getPublicSiteOrigin(): string {
  return new URL(getPublicBaseUrl()).origin
}

export function getPublicSiteUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  return new URL(normalizedPath, `${getPublicSiteOrigin()}/`).toString()
}
