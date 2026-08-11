import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkFreeProductContract } from '../../scripts/check-free-product-contract.mjs'

const temporaryRoots: string[] = []

function createFixture(files: Record<string, string>): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'wao-free-product-'))
  temporaryRoots.push(rootDir)
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(rootDir, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  return rootDir
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const rootDir = temporaryRoots.pop()
    if (rootDir) rmSync(rootDir, { recursive: true, force: true })
  }
})

describe('free product architecture contract', () => {
  it('routes the active execution and schema boundary through free-product architecture', () => {
    const modules = JSON.parse(readFileSync(path.resolve(process.cwd(), 'docs/architecture/modules.json'), 'utf8')) as {
      modules: Array<{ id: string; document: string; sourcePaths: string[] }>
    }
    const freeProduct = modules.modules.find((module) => module.id === 'free-product')
    expect(freeProduct?.document).toBe('docs/architecture/modules/free-product.md')
    expect(freeProduct?.sourcePaths).toEqual(expect.arrayContaining([
      'src/lib/operations',
      'src/lib/task',
      'prisma/schema.prisma',
      'scripts/check-free-product-contract.mjs',
    ]))
    expect(modules.modules.some((module) => module.id === 'billing-approval')).toBe(false)
  })

  it('rejects billing owners and payment dependencies in active production sources', () => {
    const rootDir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { stripe: '^1.0.0' },
        scripts: { billing: 'tsx scripts/billing-reconcile-ledger.ts' },
      }),
      'prisma/schema.prisma': 'model UserBalance { id String @id }',
      'src/lib/billing/index.ts': 'export const billing = true',
      'src/app/api/payments/route.ts': 'export const GET = () => null',
    })

    const result = checkFreeProductContract({ rootDir })

    expect(result.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('active billing directory'),
      expect.stringContaining('payment route'),
      expect.stringContaining('Stripe dependency'),
      expect.stringContaining('billing script'),
      expect.stringContaining('UserBalance'),
    ]))
  })

  it('accepts task execution and destructive approval without billing state', () => {
    const rootDir = createFixture({
      'package.json': JSON.stringify({
        dependencies: { next: '^1.0.0' },
        scripts: { typecheck: 'tsc --noEmit' },
      }),
      'prisma/schema.prisma': [
        'model Task { id String @id }',
      ].join('\n'),
      'src/lib/task/submitter.ts': 'export const submit = true',
      'src/lib/operations/planning.ts': 'export const plan = true',
    })

    expect(checkFreeProductContract({ rootDir }).violations).toEqual([])
  })
})
