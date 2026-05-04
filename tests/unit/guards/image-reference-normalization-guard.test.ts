import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function runGuard<T>(code: string): T {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return JSON.parse(output) as T
}

describe('image reference normalization guard', () => {
  it('allows shared helper exceptions explicitly', () => {
    const result = runGuard<{ hasAllowlist: boolean; violations: string[] }>(`
      import { NORMALIZATION_HELPER_ALLOWLIST, inspectImageReferenceNormalization } from './scripts/guards/image-reference-normalization-guard.mjs'
      console.log(JSON.stringify({
        hasAllowlist: NORMALIZATION_HELPER_ALLOWLIST.has('src/lib/workers/handlers/image-task-handler-shared.ts'),
        violations: inspectImageReferenceNormalization(
          'src/lib/workers/handlers/image-task-handler-shared.ts',
          'resolveImageSourceFromGeneration(job, { options: params.options })\\nreferenceImages?: string[]',
        ),
      }))
    `)

    expect(result.hasAllowlist).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('passes handlers that normalize reference images before generation', () => {
    const content = `
      import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
      async function run() {
        const normalizedRefs = await normalizeReferenceImagesForGeneration(refs)
        return await resolveImageSourceFromGeneration(job, {
          options: {
            referenceImages: normalizedRefs,
          },
        })
      }
    `

    const result = runGuard<string[]>(`
      import { inspectImageReferenceNormalization } from './scripts/guards/image-reference-normalization-guard.mjs'
      console.log(JSON.stringify(inspectImageReferenceNormalization(
        'src/lib/workers/handlers/panel-image-task-handler.ts',
        ${JSON.stringify(content)},
      )))
    `)

    expect(result).toEqual([])
  })

  it('flags handlers that send referenceImages without normalization markers', () => {
    const content = `
      async function run() {
        return await resolveImageSourceFromGeneration(job, {
          options: {
            referenceImages: refs,
          },
        })
      }
    `

    const result = runGuard<string[]>(`
      import { inspectImageReferenceNormalization } from './scripts/guards/image-reference-normalization-guard.mjs'
      console.log(JSON.stringify(inspectImageReferenceNormalization(
        'src/lib/workers/handlers/bad-handler.ts',
        ${JSON.stringify(content)},
      )))
    `)

    expect(result).toEqual([
      'src/lib/workers/handlers/bad-handler.ts uses resolveImageSourceFromGeneration with referenceImages but does not reference normalizeReferenceImagesForGeneration/normalizeToBase64ForGeneration/generateProjectLabeledImageToStorage/generateCleanImageToStorage',
    ])
  })
})
