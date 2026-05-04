import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function inspectTaskSubmitCompensation(file: string, content: string): string[] {
  const output = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import { inspectTaskSubmitCompensation } from './scripts/guards/task-submit-compensation-guard.mjs'
      console.log(JSON.stringify(inspectTaskSubmitCompensation(${JSON.stringify(file)}, ${JSON.stringify(content)})))
    `,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return JSON.parse(output) as string[]
}

describe('task submit compensation guard', () => {
  it('passes routes that create data before submitTask and define rollback handling', () => {
    const content = `
      async function rollbackCreatedRecord() {}
      export const POST = apiHandler(async () => {
        await prisma.panel.create({ data: {} })
        try {
          return await submitTask({})
        } catch (error) {
          await rollbackCreatedRecord()
          throw error
        }
      })
    `

    expect(
      inspectTaskSubmitCompensation('src/app/api/novel-promotion/[projectId]/panel-variant/route.ts', content),
    ).toEqual([])
  })

  it('ignores routes that do not combine create and submitTask', () => {
    expect(inspectTaskSubmitCompensation('src/app/api/user/api-config/route.ts', 'await submitTask({})')).toEqual([])
    expect(inspectTaskSubmitCompensation('src/app/api/projects/route.ts', 'await prisma.project.create({ data: {} })')).toEqual([])
  })

  it('flags routes that create data before submitTask without compensation marker', () => {
    const content = `
      export const POST = apiHandler(async () => {
        await prisma.panel.create({ data: {} })
        return await submitTask({})
      })
    `

    expect(
      inspectTaskSubmitCompensation('src/app/api/example/route.ts', content),
    ).toEqual([
      'src/app/api/example/route.ts creates data before submitTask without explicit rollback/compensation marker',
    ])
  })
})
