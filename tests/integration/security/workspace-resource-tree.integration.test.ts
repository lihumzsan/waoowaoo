import { beforeEach, describe, expect, it } from 'vitest'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { listWorkspaceResourceTreePage } from '@/lib/workspace-resource/view-service'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

describe('WorkspaceResource canonical tree read boundary', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('paginates 5,000 direct Canvas children without truncation or duplication', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const resources = Array.from({ length: 5_000 }, (_, index) => {
      const suffix = String(index).padStart(4, '0')
      const workspacePath = `item-${suffix}`
      return {
        id: `r${String(index).padStart(31, '0')}`,
        userId: user.id,
        projectId: project.id,
        workspacePath,
        activePath: workspacePath,
        resourceKind: 'file' as const,
        mediaType: 'image' as const,
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
        name: `item-${suffix}`,
        status: 'pending',
      }
    })
    for (let offset = 0; offset < resources.length; offset += 500) {
      await prisma.workspaceResource.createMany({ data: resources.slice(offset, offset + 500) })
    }

    const ids: string[] = []
    let cursor: string | null = null
    let pageCount = 0
    do {
      const page = await listWorkspaceResourceTreePage({
        userId: user.id,
        projectId: project.id,
        prefix: null,
        cursor,
        limit: 200,
      })
      pageCount += 1
      ids.push(...page.items.map((item) => item.resourceId))
      cursor = page.nextCursor
    } while (cursor)

    expect(pageCount).toBe(25)
    expect(ids).toHaveLength(5_000)
    expect(new Set(ids).size).toBe(5_000)
    expect(ids[0]).toBe('r0000000000000000000000000000000')
    expect(ids.at(-1)).toBe('r0000000000000000000000000004999')
  })
})
