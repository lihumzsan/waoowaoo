export function buildMurekaUrl(path: string, baseUrl?: string): string {
  const root = baseUrl?.trim().replace(/\/+$/, '') ?? ''
  if (!root) throw new Error('PROVIDER_BASE_URL_MISSING: mureka')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${root}${suffix}`
}
