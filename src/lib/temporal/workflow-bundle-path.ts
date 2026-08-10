import { fileURLToPath } from 'node:url'

export function resolveTemporalWorkflowBundlePath(
  versioningEnabled: boolean,
): string {
  return fileURLToPath(
    new URL(
      versioningEnabled
        ? './workflows/index.ts'
        : './workflows/index-unversioned.ts',
      import.meta.url,
    ),
  )
}
