import { beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  createWorkspaceResourceFolderInTransaction,
  reserveWorkspaceResourceInTransaction,
  resolveGeneratedWorkspaceResourcePlacement,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

/**
 * Persistence oracle: a missing output folder chain is accepted during read-only
 * placement and materialized with the pending Resource in one real transaction.
 */
describe('WorkspaceResource output folder materialization', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('creates every missing destination folder before reserving the output Resource', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const resourceId = createWorkspaceResourceId()
    const folderPath = '成片/配乐'
    const outputPath = await resolveGeneratedWorkspaceResourcePlacement(prisma, {
      userId: user.id,
      projectId: project.id,
      folderPath,
      name: '最终主题',
      resourceId,
      mediaType: 'audio',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
    })

    await expect(prisma.workspaceResource.count({
      where: { projectId: project.id },
    })).resolves.toBe(0)

    await prisma.$transaction(async (tx) => {
      await createWorkspaceResourceFolderInTransaction(tx, {
        userId: user.id,
        projectId: project.id,
        workspacePath: folderPath,
        sourceType: 'operation_output_folder',
        sourceId: null,
      })
      await reserveWorkspaceResourceInTransaction(tx, {
        resourceId,
        userId: user.id,
        projectId: project.id,
        outputPath,
        mediaType: 'audio',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
        operationId: 'create_audio',
      })
    })

    await expect(prisma.workspaceResource.findMany({
      where: { projectId: project.id },
      orderBy: { workspacePath: 'asc' },
      select: { workspacePath: true, resourceKind: true, status: true },
    })).resolves.toEqual([
      { workspacePath: '成片', resourceKind: 'folder', status: 'ready' },
      { workspacePath: '成片/配乐', resourceKind: 'folder', status: 'ready' },
      { workspacePath: '成片/配乐/最终主题', resourceKind: 'file', status: 'pending' },
    ])
  })
})
