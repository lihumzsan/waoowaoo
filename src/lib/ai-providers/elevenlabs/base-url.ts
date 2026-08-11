const ELEVENLABS_DEFAULT_BASE_URL = 'https://api.elevenlabs.io'

export function buildElevenLabsUrl(path: string, baseUrl?: string): string {
  const root = baseUrl?.trim().replace(/\/+$/u, '') || ELEVENLABS_DEFAULT_BASE_URL
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${root}${suffix}`
}
