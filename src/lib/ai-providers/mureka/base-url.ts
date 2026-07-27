const MUREKA_DEFAULT_BASE_URL = 'https://api.mureka.ai'

export function buildMurekaUrl(path: string, baseUrl?: string): string {
  const root = (baseUrl?.trim() || MUREKA_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${root}${suffix}`
}
