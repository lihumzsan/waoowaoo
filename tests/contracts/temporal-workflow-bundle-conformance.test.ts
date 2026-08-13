import { bundleWorkflowCode } from '@temporalio/worker'
import { describe, expect, it } from 'vitest'
import { resolveTemporalWorkflowBundlePath } from '@/lib/temporal/workflow-bundle-path'

describe('Temporal workflow bundle conformance', () => {
  it.each([false, true])(
    'bundles workflows without Node runtime modules (versioning=%s)',
    async (versioningEnabled) => {
      const bundle = await bundleWorkflowCode({
        workflowsPath: resolveTemporalWorkflowBundlePath(versioningEnabled),
        logger: {
          log: () => undefined,
          trace: () => undefined,
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      })

      expect(bundle.code.length).toBeGreaterThan(0)
    },
  )
})
