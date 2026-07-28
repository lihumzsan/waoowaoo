import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import {
  compileAssetManifest,
  screenplaySchema,
} from '@/lib/screenplay'
import {
  buildDomainCreativeResourceId,
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

const creativeDirection = {
  rawUserStyle: null,
  styleSummary: 'Restrained ink realism',
  visual: {
    visualStyle: 'Observational ink-and-paper realism with restrained color.',
    assetImageStyle: {
      lighting: 'Soft directional daylight',
      texture: 'Fibrous paper and dry-brush edges',
    },
  },
  narrative: 'Reveal character intent through observable behavior.',
  directing: 'Prefer locked frames and motivated movement.',
  editing: 'Use measured hard cuts.',
  sound: 'Preserve quiet room tone and deliberate silence.',
  assetPolicy: 'Use stable reusable silhouettes and material definitions.',
}

type MaterializedOutputKind = 'screenplay' | 'creative_direction' | 'asset_manifest'

function creativeTaskPayload(input: {
  outputKind: MaterializedOutputKind
  runId: string
  toolCallId: string
  sourceMaterials?: readonly {
    label: string
    resourceId: string
    value: unknown
  }[]
  creativeDirection?: {
    resourceId: string
    direction: typeof creativeDirection
  } | null
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
          provenance: { kind: 'resource' as const, resourceId: source.resourceId },
        })),
        constraints: [],
      },
      creativeDirection: input.creativeDirection ?? null,
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
    resourceId: string
    value: unknown
  }[]
  creativeDirection?: {
    resourceId: string
    direction: typeof creativeDirection
  } | null
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

async function createProjectResource(input: {
  userId: string
  projectId: string
  taskId: string
  schemaId: string
  name: string
  content: unknown
}) {
  const sourceId = `${input.taskId}:${input.schemaId}`
  return await prisma.creativeResource.create({
    data: {
      id: buildDomainCreativeResourceId({
        sourceType: 'CreativeWorkResult',
        sourceId,
      }),
      userId: input.userId,
      projectId: input.projectId,
      episodeId: null,
      scopeKind: 'project',
      scopeId: input.projectId,
      mediaType: 'text',
      schemaId: input.schemaId,
      name: input.name,
      status: 'ready',
      sourceType: 'CreativeWorkResult',
      sourceId,
      contentJson: input.content as Prisma.InputJsonValue,
      modelKey: 'test:creative-model',
      operationId: 'delegate_creative_work',
      inputHash: 'a'.repeat(64),
      taskId: input.taskId,
      toolCallId: 'asset-adoption:creative-tool',
      materializedAt: new Date(),
    },
  })
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
   * Oracle: exact re-adoption reuses manifest identities; replacing the adopted Direction does not
   * rewrite the frozen Task or block adoption, while missing screenplay lineage fails closed without
   * changing Project assets, the adopted Manifest, or starting media Tasks.
   * Command: BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/task/asset-manifest-adoption.integration.test.ts
   */
  it('keeps manifest adoption idempotent across Direction replacement and fails closed on missing screenplay lineage', async () => {
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
    const screenplay = screenplaySchema.parse({
      kind: 'screenplay',
      title: 'The Letter',
      logline: null,
      synopsis: 'Lin reaches an old station with a sealed letter.',
      screenplayText,
      source: { kind: 'provided', label: 'User screenplay' },
      assumptions: [],
      openQuestions: [],
    })
    const screenplayTask = await createCompletedCreativeTask({
      userId: user.id,
      projectId: project.id,
      outputKind: 'screenplay',
      runId: run.id,
      toolCallId,
    })
    const screenplayResource = await createProjectResource({
      userId: user.id,
      projectId: project.id,
      taskId: screenplayTask.id,
      schemaId: CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
      name: screenplay.title,
      content: screenplay,
    })
    const styleTask = await createCompletedCreativeTask({
      userId: user.id,
      projectId: project.id,
      outputKind: 'creative_direction',
      runId: run.id,
      toolCallId,
    })
    const styleResource = await createProjectResource({
      userId: user.id,
      projectId: project.id,
      taskId: styleTask.id,
      schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
      name: creativeDirection.styleSummary,
      content: creativeDirection,
    })
    const adoptedStyleBinding = await prisma.creativeResourceBinding.create({
      data: {
        userId: user.id,
        projectId: project.id,
        episodeId: null,
        scopeKind: 'project',
        scopeId: project.id,
        ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection,
        resourceId: styleResource.id,
        source: 'style_adoption',
      },
    })
    const manifest = compileAssetManifest({
      manifest: {
        kind: 'asset_manifest',
        overview: 'Exact screenplay-grounded assets.',
        assets: [
          {
            kind: 'character',
            canonicalName: 'Lin',
            aliases: [],
            stableDescription: 'A tired traveler with a weathered coat and alert posture.',
            generationPrompt: 'Character reference for Lin in the adopted ink realism.',
          },
          {
            kind: 'location',
            canonicalName: 'Old Station',
            aliases: ['Station'],
            stableDescription: 'An abandoned station interior with worn platforms and iron beams.',
            generationPrompt: 'Environment reference for the old station in the adopted ink realism.',
          },
          {
            kind: 'prop',
            canonicalName: 'Sealed Letter',
            aliases: ['Letter'],
            stableDescription: 'A weathered envelope closed by a dark wax seal.',
            generationPrompt: 'Prop reference for the sealed letter in the adopted ink realism.',
          },
        ],
        assumptions: [],
        warnings: [],
      },
    })
    const manifestTask = await createCompletedCreativeTask({
      userId: user.id,
      projectId: project.id,
      outputKind: 'asset_manifest',
      runId: run.id,
      toolCallId,
      sourceMaterials: [
        {
          label: 'Canonical screenplay',
          resourceId: screenplayResource.id,
          value: screenplay,
        },
      ],
      creativeDirection: {
        resourceId: styleResource.id,
        direction: creativeDirection,
      },
    })
    const manifestResource = await createProjectResource({
      userId: user.id,
      projectId: project.id,
      taskId: manifestTask.id,
      schemaId: CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
      name: 'Exact manifest assets',
      content: manifest,
    })
    await prisma.creativeResourceLineage.createMany({
      data: [
        {
          outputResourceId: manifestResource.id,
          inputResourceId: screenplayResource.id,
          role: 'source_material',
          position: 0,
        },
        {
          outputResourceId: manifestResource.id,
          inputResourceId: styleResource.id,
          role: 'creative_direction',
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
      input: { resourceId: manifestResource.id, expectedVersion: null },
    })
    expect(first).toMatchObject({
      kind: 'executed',
      data: {
        success: true,
        resourceId: manifestResource.id,
        bindingVersion: 0,
        imageGenerationStarted: false,
        assets: [
          { manifestAssetId: manifest.assets[0]?.manifestAssetId, kind: 'character', created: true },
          { manifestAssetId: manifest.assets[1]?.manifestAssetId, kind: 'location', created: true },
          { manifestAssetId: manifest.assets[2]?.manifestAssetId, kind: 'prop', created: true },
        ],
      },
    })

    const second = await invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: 'adopt_asset_manifest',
      context,
      input: { resourceId: manifestResource.id, expectedVersion: 0 },
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
    expect(characters[0]?.manifestAssetId).toBe(manifest.assets[0]?.manifestAssetId)
    expect(locations.map((location) => location.manifestAssetId).sort()).toEqual(
      manifest.assets.slice(1).map((asset) => asset.manifestAssetId).sort(),
    )
    expect(appearances).toBe(1)
    expect(locationImages).toBe(2)
    expect(tasks).toHaveLength(3)
    expect(tasks.every((task) => task.type === TASK_TYPE.CREATIVE_WORK)).toBe(true)
    expect(binding).toMatchObject({
      resourceId: manifestResource.id,
      version: 1,
      scopeKind: 'project',
      scopeId: project.id,
    })

    const replacementStyle = {
      ...creativeDirection,
      styleSummary: 'High-contrast charcoal expressionism',
      visual: {
        ...creativeDirection.visual,
        visualStyle: 'Expressive charcoal marks with stark light and deep shadow.',
      },
    }
    const replacementStyleTask = await createCompletedCreativeTask({
      userId: user.id,
      projectId: project.id,
      outputKind: 'creative_direction',
      runId: run.id,
      toolCallId,
    })
    const replacementStyleResource = await createProjectResource({
      userId: user.id,
      projectId: project.id,
      taskId: replacementStyleTask.id,
      schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
      name: replacementStyle.styleSummary,
      content: replacementStyle,
    })
    await prisma.creativeResourceBinding.update({
      where: { id: adoptedStyleBinding.id },
      data: {
        resourceId: replacementStyleResource.id,
      },
    })

    const afterDirectionReplacement = await invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: 'adopt_asset_manifest',
      context,
      input: { resourceId: manifestResource.id, expectedVersion: 1 },
    })
    expect(afterDirectionReplacement).toMatchObject({
      kind: 'executed',
      data: {
        bindingVersion: 2,
        imageGenerationStarted: false,
        assets: [{ created: false }, { created: false }, { created: false }],
      },
    })

    await prisma.creativeResourceLineage.deleteMany({
      where: {
        outputResourceId: manifestResource.id,
        inputResourceId: screenplayResource.id,
      },
    })

    await expect(invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: 'adopt_asset_manifest',
      context,
      input: { resourceId: manifestResource.id, expectedVersion: 2 },
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: {
        code: 'ASSET_MANIFEST_EXACT_SCREENPLAY_SOURCE_REQUIRED',
        field: 'resourceId',
      },
    })

    const [finalCharacters, finalLocations, finalTasks, finalBinding] = await Promise.all([
      prisma.projectCharacter.count({ where: { projectId: project.id } }),
      prisma.projectLocation.count({ where: { projectId: project.id } }),
      prisma.task.findMany({ where: { projectId: project.id }, select: { type: true } }),
      prisma.creativeResourceBinding.findUniqueOrThrow({
        where: { id: adoptedStyleBinding.id },
      }),
    ])
    expect(finalCharacters).toBe(1)
    expect(finalLocations).toBe(2)
    expect(finalTasks).toHaveLength(4)
    expect(finalTasks.every((task) => task.type === TASK_TYPE.CREATIVE_WORK)).toBe(true)
    expect(finalBinding).toMatchObject({
      resourceId: replacementStyleResource.id,
      version: 0,
    })
    const adoptedManifest = await prisma.creativeResourceBinding.findUniqueOrThrow({
      where: {
        scopeKind_scopeId_role_slotKey: {
          scopeKind: 'project',
          scopeId: project.id,
          ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedAssetManifest,
        },
      },
    })
    expect(adoptedManifest).toMatchObject({
      resourceId: manifestResource.id,
      version: 2,
    })
  })
})
