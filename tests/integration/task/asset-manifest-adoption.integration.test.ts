import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { compileCanonicalScreenplay } from '@/lib/canonical-screenplay'
import {
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  CREATIVE_RESOURCE_SCHEMA,
} from '@/lib/creative-resource'
import { CREATIVE_WORK_TASK_PROTOCOL } from '@/lib/creative-worker'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

const styleBible = {
  rawUserStyle: null,
  styleSummary: 'Restrained ink realism',
  visualStyle: 'Observational ink-and-paper realism with restrained color.',
  assetImageStyle: {
    lighting: 'Soft directional daylight',
    texture: 'Fibrous paper and dry-brush edges',
  },
}

type MaterializedOutputKind = 'canonical_screenplay' | 'style_bible' | 'asset_manifest'

function creativeTaskPayload(input: {
  outputKind: MaterializedOutputKind
  runId: string
  toolCallId: string
  sourceMaterials?: readonly {
    label: string
    revisionId: string
    value: unknown
  }[]
}) {
  const requestKey = `asset-adoption:${input.outputKind}`
  const goal = `Produce ${input.outputKind}.`
  return {
    protocol: CREATIVE_WORK_TASK_PROTOCOL,
    requestKey,
    request: {
      outputKind: input.outputKind,
      goal,
      context: {
        userRequest: goal,
        sourceMaterials: (input.sourceMaterials ?? []).map((source) => ({
          label: source.label,
          kind: 'structured' as const,
          content: JSON.stringify(source.value),
          provenance: { kind: 'resource' as const, revisionId: source.revisionId },
        })),
        constraints: [],
      },
      productionContext: { video: null },
    },
    modelKey: 'test:creative-model',
    inputFingerprint: input.outputKind.padEnd(64, '0'),
    origin: { runId: input.runId, toolCallId: input.toolCallId },
    lifecycleProjection: {
      requestKey,
      outputKind: input.outputKind,
      goal,
      events: [],
    },
  }
}

async function createCompletedCreativeTask(input: {
  userId: string
  projectId: string
  outputKind: MaterializedOutputKind
  runId: string
  toolCallId: string
  sourceMaterials?: readonly {
    label: string
    revisionId: string
    value: unknown
  }[]
}) {
  return await prisma.task.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      episodeId: null,
      type: TASK_TYPE.CREATIVE_WORK,
      targetType: 'CreativeWork',
      targetId: `asset-adoption:${input.outputKind}`,
      status: TASK_STATUS.COMPLETED,
      operationId: 'delegate_creative_work',
      payload: creativeTaskPayload(input),
      result: {},
      finishedAt: new Date(),
    },
  })
}

async function createProjectResourceRevision(input: {
  userId: string
  projectId: string
  taskId: string
  schemaId: string
  name: string
  content: unknown
}) {
  const resource = await prisma.creativeResource.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      episodeId: null,
      scopeKind: 'project',
      scopeId: input.projectId,
      mediaType: 'text',
      schemaId: input.schemaId,
      name: input.name,
      status: 'ready',
      originKey: `asset-adoption:${input.taskId}:${input.schemaId}`,
      sourceType: 'CreativeWorkResult',
      sourceId: `${input.taskId}:${input.schemaId}`,
    },
  })
  const revision = await prisma.creativeResourceRevision.create({
    data: {
      resourceId: resource.id,
      revision: 1,
      contentJson: input.content as Prisma.InputJsonValue,
      sourceType: 'CreativeWorkResult',
      sourceId: input.taskId,
      sourceRevision: input.schemaId,
      modelKey: 'test:creative-model',
      operationId: 'delegate_creative_work',
      inputHash: 'a'.repeat(64),
      taskId: input.taskId,
      toolCallId: 'asset-adoption:creative-tool',
    },
  })
  await prisma.creativeResource.update({
    where: { id: resource.id },
    data: { headRevisionId: revision.id },
  })
  return { resource, revision }
}

describe('Asset Manifest adoption DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  /**
   * Authority: CR-22/CR-23 exact manifest adoption and the unique Project asset writer.
   * Rejects: duplicate Project identities, manifest-owned image Tasks, or a second asset write path.
   * Production entry: registered adopt_asset_manifest Operation through the canonical invocation service.
   * Oracle: a repeated exact Revision reuses all canonical identities, advances one Binding, and creates no media Task.
   * Command: BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/task/asset-manifest-adoption.integration.test.ts
   */
  it('reuses exact canonical Project asset identities without starting image generation', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const toolCallId = 'asset-adoption:creative-tool'
    const { run } = await createProjectAgentUserTurnRun({
      runId: 'asset-adoption:run',
      requestId: 'asset-adoption:request',
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: 'asset-adoption:user-message',
        role: 'user',
        parts: [{ type: 'text', text: 'Adopt the exact asset manifest.' }],
      },
    })
    const screenplayText = 'INT. STATION — NIGHT\nLin holds a sealed letter.'
    const screenplay = compileCanonicalScreenplay({
      kind: 'canonical_screenplay',
      title: 'The Letter',
      logline: null,
      synopsis: 'Lin reaches an old station with a sealed letter.',
      screenplayText,
      estimatedDurationSeconds: 60,
      source: { kind: 'provided', label: 'User screenplay' },
      entities: {
        characters: [{ canonicalName: 'Lin', aliases: [], description: 'A tired traveler.' }],
        locations: [{ canonicalName: 'Old Station', aliases: [], description: 'An abandoned station.' }],
        props: [{ canonicalName: 'Sealed Letter', aliases: [], description: 'A weathered sealed letter.' }],
      },
      scenes: [{
        order: 1,
        heading: 'INT. STATION — NIGHT',
        summary: 'Lin enters with the letter.',
        sourceStart: 0,
        sourceEnd: screenplayText.length,
        locationCanonicalName: 'Old Station',
        characterCanonicalNames: ['Lin'],
        propCanonicalNames: ['Sealed Letter'],
      }],
      assumptions: [],
      openQuestions: [],
    })
    const screenplayTask = await createCompletedCreativeTask({
      userId: user.id,
      projectId: project.id,
      outputKind: 'canonical_screenplay',
      runId: run.id,
      toolCallId,
    })
    const screenplayRevision = await createProjectResourceRevision({
      userId: user.id,
      projectId: project.id,
      taskId: screenplayTask.id,
      schemaId: CREATIVE_RESOURCE_SCHEMA.CANONICAL_SCREENPLAY,
      name: screenplay.title,
      content: screenplay,
    })
    const styleTask = await createCompletedCreativeTask({
      userId: user.id,
      projectId: project.id,
      outputKind: 'style_bible',
      runId: run.id,
      toolCallId,
    })
    const styleRevision = await createProjectResourceRevision({
      userId: user.id,
      projectId: project.id,
      taskId: styleTask.id,
      schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
      name: styleBible.styleSummary,
      content: styleBible,
    })
    await prisma.creativeResourceBinding.create({
      data: {
        userId: user.id,
        projectId: project.id,
        episodeId: null,
        scopeKind: 'project',
        scopeId: project.id,
        ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedStyleBible,
        resourceId: styleRevision.resource.id,
        revisionId: styleRevision.revision.id,
        source: 'style_adoption',
      },
    })
    const entities = [
      ...screenplay.entities.characters,
      ...screenplay.entities.locations,
      ...screenplay.entities.props,
    ]
    const manifest = {
      kind: 'asset_manifest' as const,
      overview: 'Exact canonical assets.',
      assets: entities.map((entity) => ({
        canonicalEntity: { entityId: entity.entityId, kind: entity.kind },
        title: entity.canonicalName,
        stableDescription: entity.description,
        generationPrompt: `Design ${entity.canonicalName} in the adopted style.`,
        negativePrompt: null,
        referenceRequirements: [],
        continuityRequirements: [],
      })),
      assumptions: [],
      warnings: [],
    }
    const manifestTask = await createCompletedCreativeTask({
      userId: user.id,
      projectId: project.id,
      outputKind: 'asset_manifest',
      runId: run.id,
      toolCallId,
      sourceMaterials: [
        {
          label: 'Canonical screenplay',
          revisionId: screenplayRevision.revision.id,
          value: screenplay,
        },
        {
          label: 'Style Bible',
          revisionId: styleRevision.revision.id,
          value: styleBible,
        },
      ],
    })
    const manifestRevision = await createProjectResourceRevision({
      userId: user.id,
      projectId: project.id,
      taskId: manifestTask.id,
      schemaId: CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
      name: 'Exact canonical assets',
      content: manifest,
    })
    await prisma.creativeResourceLineage.createMany({
      data: [
        {
          outputRevisionId: manifestRevision.revision.id,
          inputRevisionId: screenplayRevision.revision.id,
          role: 'source_material',
          position: 0,
        },
        {
          outputRevisionId: manifestRevision.revision.id,
          inputRevisionId: styleRevision.revision.id,
          role: 'source_material',
          position: 1,
        },
      ],
    })
    const executionFence = {
      runFence: createProjectAgentRunFence(run),
      signal: new AbortController().signal,
    }
    const context = {
      request: new NextRequest('http://localhost/api/projects/test/assistant/chat'),
      userId: user.id,
      projectId: project.id,
      context: {},
      source: 'assistant-panel',
      writer: null,
      toolCallId: 'asset-adoption:adopt-tool',
      executionFence,
    } as ProjectAgentOperationContext
    const registry = createProjectAgentOperationRegistry()

    const first = await invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: 'adopt_asset_manifest',
      context,
      input: { revisionId: manifestRevision.revision.id, expectedVersion: null },
    })
    expect(first).toMatchObject({
      kind: 'executed',
      data: {
        success: true,
        revisionId: manifestRevision.revision.id,
        bindingVersion: 0,
        imageGenerationStarted: false,
        assets: [
          { canonicalEntityId: entities[0]?.entityId, kind: 'character', created: true },
          { canonicalEntityId: entities[1]?.entityId, kind: 'location', created: true },
          { canonicalEntityId: entities[2]?.entityId, kind: 'prop', created: true },
        ],
      },
    })

    const second = await invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: 'adopt_asset_manifest',
      context,
      input: { revisionId: manifestRevision.revision.id, expectedVersion: 0 },
    })
    expect(second).toMatchObject({
      kind: 'executed',
      data: {
        bindingVersion: 1,
        imageGenerationStarted: false,
        assets: [{ created: false }, { created: false }, { created: false }],
      },
    })

    const [characters, locations, appearances, locationImages, tasks, binding] = await Promise.all([
      prisma.projectCharacter.findMany({ where: { projectId: project.id } }),
      prisma.projectLocation.findMany({ where: { projectId: project.id }, orderBy: { assetKind: 'asc' } }),
      prisma.characterAppearance.count({ where: { character: { projectId: project.id } } }),
      prisma.locationImage.count({ where: { location: { projectId: project.id } } }),
      prisma.task.findMany({ where: { projectId: project.id }, select: { type: true } }),
      prisma.creativeResourceBinding.findUniqueOrThrow({
        where: {
          scopeKind_scopeId_role_slotKey: {
            scopeKind: 'project',
            scopeId: project.id,
            ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedAssetManifest,
          },
        },
      }),
    ])
    expect(characters).toHaveLength(1)
    expect(locations).toHaveLength(2)
    expect(appearances).toBe(1)
    expect(locationImages).toBe(2)
    expect(tasks).toHaveLength(3)
    expect(tasks.every((task) => task.type === TASK_TYPE.CREATIVE_WORK)).toBe(true)
    expect(binding).toMatchObject({
      revisionId: manifestRevision.revision.id,
      version: 1,
      scopeKind: 'project',
      scopeId: project.id,
    })
  })
})
