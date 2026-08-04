import { APP_VERSION, GITHUB_REPOSITORY } from '@/lib/app-meta'

export interface SecurityExternalBoundaryResponse {
  readonly status: number
  readonly contentType: string
  readonly body: string
}

export function resolveSecurityExternalBoundary(input: {
  readonly method: string
  readonly url: string
}): SecurityExternalBoundaryResponse | null {
  const url = new URL(input.url)
  if (
    input.method !== 'GET'
    || url.protocol !== 'https:'
    || url.hostname !== 'api.github.com'
    || url.pathname !== `/repos/${GITHUB_REPOSITORY}/releases/latest`
    || url.search !== ''
  ) {
    return null
  }
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tag_name: `v${APP_VERSION}`,
      html_url: `https://github.com/${GITHUB_REPOSITORY}/releases/tag/v${APP_VERSION}`,
      name: `v${APP_VERSION}`,
      published_at: '2026-01-01T00:00:00.000Z',
    }),
  }
}
