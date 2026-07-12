import { readFile } from 'node:fs/promises'
import { stopTestServices } from '../../setup/test-services'
import { resolveGoldenArtifactRoot } from './identity'

interface GoldenEnvironmentDescriptor {
  readonly testServiceScope?: unknown
  readonly coordinatorBaseUrl?: unknown
  readonly shutdownToken?: unknown
}

export default async function goldenGlobalTeardown(): Promise<void> {
  if (process.env.GOLDEN_EXTERNAL_ENV === '1') return
  const descriptorPath = `${resolveGoldenArtifactRoot()}/environment.json`
  let descriptor: GoldenEnvironmentDescriptor
  try {
    descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as GoldenEnvironmentDescriptor
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
    if (code === 'ENOENT') return
    throw error
  }
  const composeProjectName = typeof descriptor.testServiceScope === 'string'
    ? descriptor.testServiceScope.trim()
    : ''
  if (!composeProjectName.startsWith('waoowaoo-golden-')) {
    throw new Error(`GOLDEN_TEARDOWN_SCOPE_INVALID:${composeProjectName || 'missing'}`)
  }
  const coordinatorBaseUrl = typeof descriptor.coordinatorBaseUrl === 'string'
    ? descriptor.coordinatorBaseUrl.trim()
    : ''
  const shutdownToken = typeof descriptor.shutdownToken === 'string'
    ? descriptor.shutdownToken.trim()
    : ''
  if (coordinatorBaseUrl && shutdownToken) {
    try {
      const response = await fetch(`${coordinatorBaseUrl}/shutdown`, {
        method: 'POST',
        headers: { authorization: `Bearer ${shutdownToken}` },
      })
      if (response.status !== 202) {
        throw new Error(`GOLDEN_TEARDOWN_SHUTDOWN_HTTP_${String(response.status)}`)
      }
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        try {
          await fetch(`${coordinatorBaseUrl}/health`)
        } catch {
          return
        }
      }
      throw new Error('GOLDEN_TEARDOWN_SHUTDOWN_TIMEOUT')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('fetch failed') && !message.includes('ECONNREFUSED')) throw error
    }
  }
  stopTestServices({ composeProjectName })
}
