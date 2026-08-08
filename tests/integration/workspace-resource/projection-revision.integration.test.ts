import { beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  reserveWorkspaceResourceInTransaction,
} from '@/lib/workspace-resource/persistence'
import { readWorkspaceResourceRevision } from '@/lib/workspace-resource/projection-revision'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { listWorkspaceResourceTreePage } from '@/lib/workspace-resource/view-service'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

async function reserveAudioResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly workspacePath: string
}): Promise<string> {
  const resourceId = createWorkspaceResourceId()
  await prisma.$transaction(async (tx) => {
    await reserveWorkspaceResourceInTransaction(tx, {
      resourceId,
      userId: input.userId,
      projectId: input.projectId,
      outputPath: input.workspacePath,
      mediaType: 'audio',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
      operationId: 'create_audio',
    })
  })
  return resourceId
}

/**
 * Persistence oracle: the project projection revision and WorkspaceResource
 * mutation share the same real MySQL transaction and project lock.
 */
describe('WorkspaceResource projection revision', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('publishes only committed resource mutations to the formal View revision', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)

    await expect(readWorkspaceResourceRevision({
      userId: user.id,
      projectId: project.id,
    })).resolves.toBe(0)

    await reserveAudioResource({
      userId: user.id,
      projectId: project.id,
      workspacePath: '已提交主题',
    })

    await expect(readWorkspaceResourceRevision({
      userId: user.id,
      projectId: project.id,
    })).resolves.toBe(1)

    const rolledBackResourceId = createWorkspaceResourceId()
    await expect(prisma.$transaction(async (tx) => {
      await reserveWorkspaceResourceInTransaction(tx, {
        resourceId: rolledBackResourceId,
        userId: user.id,
        projectId: project.id,
        outputPath: '不应出现的主题',
        mediaType: 'audio',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
        operationId: 'create_audio',
      })
      throw new Error('ROLL_BACK_RESOURCE_AND_REVISION')
    })).rejects.toThrow('ROLL_BACK_RESOURCE_AND_REVISION')

    await expect(readWorkspaceResourceRevision({
      userId: user.id,
      projectId: project.id,
    })).resolves.toBe(1)
    await expect(prisma.workspaceResource.findUnique({
      where: { id: rolledBackResourceId },
    })).resolves.toBeNull()

    const page = await listWorkspaceResourceTreePage({
      userId: user.id,
      projectId: project.id,
    })
    expect(page.revision).toBe(1)
    expect(page.items.map((item) => item.workspacePath)).toEqual(['已提交主题'])
  })

  it('does not lose revision advances when resource transactions commit concurrently', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const resourceCount = 8

    await Promise.all(Array.from({ length: resourceCount }, async (_, index) => {
      await reserveAudioResource({
        userId: user.id,
        projectId: project.id,
        workspacePath: `并发主题-${index}`,
      })
    }))

    await expect(readWorkspaceResourceRevision({
      userId: user.id,
      projectId: project.id,
    })).resolves.toBe(resourceCount)
    await expect(prisma.workspaceResource.count({
      where: { projectId: project.id },
    })).resolves.toBe(resourceCount)
  })
})
