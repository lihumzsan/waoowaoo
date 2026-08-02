import { beforeEach, describe, expect, it } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { createWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  reconcileWorkspaceResourceTreeInTransaction,
  restoreWorkspaceResource,
  softDeleteWorkspacePath,
  type WorkspaceResourceTreeBaselineEntry,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { listWorkspaceResourceTreePage } from '@/lib/workspace-resource/view-service'
import { createQueuedTask, createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

async function activeBaseline(projectId: string): Promise<readonly WorkspaceResourceTreeBaselineEntry[]> {
  const resources = await prisma.workspaceResource.findMany({
    where: { projectId, deletedAt: null, activePath: { not: null } },
    orderBy: { workspacePath: 'asc' },
  })
  return resources.map((resource) => ({
    resourceId: resource.id,
    workspacePath: resource.workspacePath,
    resourceKind: resource.resourceKind === 'folder' ? 'folder' : 'file',
    mediaType: resource.mediaType === null
      ? null
      : resource.mediaType as 'text' | 'image' | 'audio' | 'video',
    contentVersion: resource.currentVersion,
  }))
}

describe('WorkspaceResource canonical tree transaction boundary', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('preserves identities across a subtree move and rejects stale checkpoint overwrite', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const seriesId = createWorkspaceResourceId()
    const sectionId = createWorkspaceResourceId()

    await prisma.$transaction(async (tx) => await reconcileWorkspaceResourceTreeInTransaction(tx, {
      userId: user.id,
      projectId: project.id,
      baseline: [],
      entries: [
        { resourceId: seriesId, workspacePath: 'drafts', resourceKind: 'folder', mediaType: null, content: null },
        { resourceId: sectionId, workspacePath: 'drafts/01', resourceKind: 'folder', mediaType: null, content: null },
      ],
      sourceTurnId: 'turn-create',
    }))
    const originalBaseline = await activeBaseline(project.id)

    const changes = await prisma.$transaction(async (tx) => await reconcileWorkspaceResourceTreeInTransaction(tx, {
      userId: user.id,
      projectId: project.id,
      baseline: originalBaseline,
      entries: [
        { resourceId: seriesId, workspacePath: 'series', resourceKind: 'folder', mediaType: null, content: null },
        { resourceId: sectionId, workspacePath: 'series/01', resourceKind: 'folder', mediaType: null, content: null },
      ],
      sourceTurnId: 'turn-move',
    }))

    expect(changes).toEqual([
      { kind: 'moved', resourceId: seriesId, beforePath: 'drafts', afterPath: 'series' },
      { kind: 'moved', resourceId: sectionId, beforePath: 'drafts/01', afterPath: 'series/01' },
    ])
    await expect(prisma.workspaceResource.findMany({
      where: { projectId: project.id },
      orderBy: { workspacePath: 'asc' },
      select: { id: true, workspacePath: true, activePath: true },
    })).resolves.toEqual([
      { id: seriesId, workspacePath: 'series', activePath: 'series' },
      { id: sectionId, workspacePath: 'series/01', activePath: 'series/01' },
    ])

    await expect(prisma.$transaction(async (tx) => await reconcileWorkspaceResourceTreeInTransaction(tx, {
      userId: user.id,
      projectId: project.id,
      baseline: originalBaseline,
      entries: [],
      sourceTurnId: 'stale-turn',
    }))).rejects.toThrow('WORKSPACE_RESOURCE_BASELINE_DIVERGED')
    await expect(prisma.workspaceResource.count({
      where: { projectId: project.id, deletedAt: null },
    })).resolves.toBe(2)
  })

  it('blocks active production moves and gives delete/restore one fail-closed meaning', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const seriesId = createWorkspaceResourceId()
    const sectionId = createWorkspaceResourceId()

    await prisma.$transaction(async (tx) => await reconcileWorkspaceResourceTreeInTransaction(tx, {
      userId: user.id,
      projectId: project.id,
      baseline: [],
      entries: [
        { resourceId: seriesId, workspacePath: 'series', resourceKind: 'folder', mediaType: null, content: null },
        { resourceId: sectionId, workspacePath: 'series/01', resourceKind: 'folder', mediaType: null, content: null },
      ],
    }))
    const baseline = await activeBaseline(project.id)
    const task = await createQueuedTask({
      id: 'workspace-resource-tree-active-task',
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
      targetType: 'WorkspaceResource',
      targetId: sectionId,
      payload: { resourceId: sectionId },
    })

    await expect(prisma.$transaction(async (tx) => await reconcileWorkspaceResourceTreeInTransaction(tx, {
      userId: user.id,
      projectId: project.id,
      baseline,
      entries: [
        { resourceId: seriesId, workspacePath: 'series', resourceKind: 'folder', mediaType: null, content: null },
        { resourceId: sectionId, workspacePath: 'series/02', resourceKind: 'folder', mediaType: null, content: null },
      ],
    }))).rejects.toThrow('WORKSPACE_RESOURCE_ACTIVE_TASK_CONFLICT')

    await prisma.task.update({
      where: { id: task.id },
      data: { status: TASK_STATUS.COMPLETED, finishedAt: new Date() },
    })
    await expect(softDeleteWorkspacePath({
      userId: user.id,
      projectId: project.id,
      workspacePath: 'series',
    })).resolves.toBe(2)

    const replacementId = createWorkspaceResourceId()
    await prisma.$transaction(async (tx) => await reconcileWorkspaceResourceTreeInTransaction(tx, {
      userId: user.id,
      projectId: project.id,
      baseline: [],
      entries: [
        { resourceId: replacementId, workspacePath: 'series', resourceKind: 'folder', mediaType: null, content: null },
      ],
    }))
    await expect(restoreWorkspaceResource({
      userId: user.id,
      projectId: project.id,
      resourceId: seriesId,
    })).rejects.toThrow('WORKSPACE_RESOURCE_PATH_CONFLICT')

    await expect(restoreWorkspaceResource({
      userId: user.id,
      projectId: project.id,
      resourceId: seriesId,
      workspacePath: 'archive',
    })).resolves.toEqual({ resourceId: seriesId, workspacePath: 'archive', restoredCount: 2 })
    await expect(prisma.workspaceResource.findUnique({ where: { id: sectionId } })).resolves.toMatchObject({
      workspacePath: 'archive/01',
      activePath: 'archive/01',
      deletedAt: null,
    })
  })

  it('never lets a pending Resource disappear through a workspace delete', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const resourceId = createWorkspaceResourceId()
    await prisma.workspaceResource.create({
      data: {
        id: resourceId,
        userId: user.id,
        projectId: project.id,
        workspacePath: 'pending.resource',
        activePath: 'pending.resource',
        resourceKind: 'file',
        mediaType: 'image',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
        name: 'pending',
        status: 'pending',
        sourceType: 'test_pending',
        sourceId: resourceId,
      },
    })

    await expect(softDeleteWorkspacePath({
      userId: user.id,
      projectId: project.id,
      workspacePath: 'pending.resource',
    })).rejects.toThrow('WORKSPACE_RESOURCE_PENDING_DELETE_CONFLICT')
    await expect(prisma.workspaceResource.findUnique({ where: { id: resourceId } })).resolves.toMatchObject({
      activePath: 'pending.resource',
      deletedAt: null,
    })
  })

  it('paginates 5,000 direct Canvas children without truncation or duplication', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const resources = Array.from({ length: 5_000 }, (_, index) => {
      const suffix = String(index).padStart(4, '0')
      const workspacePath = `item-${suffix}.resource`
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
