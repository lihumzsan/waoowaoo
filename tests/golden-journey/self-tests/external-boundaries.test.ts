import { describe, expect, it } from 'vitest'
import { APP_VERSION, GITHUB_REPOSITORY } from '@/lib/app-meta'
import { checkGithubReleaseUpdate } from '@/lib/update-check'
import { resolveGoldenExternalBoundary } from '../browser/external-boundaries'

describe('Golden browser external boundaries', () => {
  it('substitutes only the exact GitHub release protocol and remains compatible with the production parser', async () => {
    const result = await checkGithubReleaseUpdate({
      repository: GITHUB_REPOSITORY,
      currentVersion: APP_VERSION,
      fetchImpl: async (url, init) => {
        const response = resolveGoldenExternalBoundary({
          method: init?.method ?? 'GET',
          url: String(url),
        })
        if (!response) throw new Error('UNEXPECTED_EXTERNAL_REQUEST')
        return new Response(response.body, {
          status: response.status,
          headers: { 'content-type': response.contentType },
        })
      },
    })
    expect(result).toMatchObject({ kind: 'no-update', latestVersion: APP_VERSION })
    expect(resolveGoldenExternalBoundary({
      method: 'POST',
      url: `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`,
    })).toBeNull()
    expect(resolveGoldenExternalBoundary({
      method: 'GET',
      url: 'https://api.github.com/repos/another/repository/releases/latest',
    })).toBeNull()
  })
})
