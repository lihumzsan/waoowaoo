import { readFile } from 'node:fs/promises'
import { stopTestServices } from '../../setup/test-services'
import { resolveSecurityArtifactRoot } from './identity'

interface SecurityEnvironmentDescriptor {
  readonly testServiceScope?: unknown
}

export default async function securityGlobalTeardown(): Promise<void> {
  if (process.env.SECURITY_EXTERNAL_ENV === '1') return
  const descriptorPath = `${resolveSecurityArtifactRoot()}/environment.json`
  let descriptor: SecurityEnvironmentDescriptor
  try {
    descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as SecurityEnvironmentDescriptor
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
  if (!composeProjectName.startsWith('waoowaoo-security-')) {
    throw new Error(`SECURITY_TEARDOWN_SCOPE_INVALID:${composeProjectName || 'missing'}`)
  }
  stopTestServices({ composeProjectName })
}
