import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { PLATFORM_VOICE_DESIGN_MODEL_KEY } from '@/lib/ai-registry/voice-design-contract'
import { CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE } from '@/lib/creative-resource/contracts'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { materializeCreativeResourceTaskTerminalInTransaction } from '@/lib/creative-resource/task-materializer'
import { TASK_TYPE } from '@/lib/task/types'
import {
  bindCharacterVoiceInTransaction,
  deleteVoiceResourceInTransaction,
} from '@/lib/voice/voice-resource-service'
import { resetSystemState } from '../../helpers/db-reset'
import { createQueuedTask } from '../../helpers/billing-fixtures'
import { createFixtureProject, createFixtureUser } from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'

type VoiceBindingRequest = {
  readonly characterId: string
  readonly expectedVersion: number | null
}

function buildVoicePayload(resourceId: string, binding?: VoiceBindingRequest) {
  return {
    lifecycleProjection: {
      resources: [{
        resourceId,
        mediaType: 'audio' as const,
        schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        name: 'Voice preview',
      }],
    },
    resource: {
      resourceId,
      mediaType: 'audio' as const,
      schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      prompt: 'A calm, low voice with precise diction.',
      modelKey: PLATFORM_VOICE_DESIGN_MODEL_KEY,
      inputHash: randomUUID().replaceAll('-', ''),
      inputs: [],
      imageInputPositions: [],
      audioInputPositions: [],
      generationOptions: { language: 'English' },
      executionSegmentId: null,
      toolCallId: null,
      ...(binding ? {
        binding: {
          kind: 'character_voice' as const,
          characterId: binding.characterId,
          expectedVersion: binding.expectedVersion,
        },
      } : {}),
    },
    voiceModel: PLATFORM_VOICE_DESIGN_MODEL_KEY,
    prompt: 'A calm, low voice with precise diction.',
    previewText: 'The river is quiet tonight.',
    language: 'English',
    count: 1 as const,
    generationOptions: { language: 'English' },
  }
}

async function reserveVoiceResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly name: string
}) {
  const id = randomUUID()
  await prisma.creativeResource.create({
    data: {
      id,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: null,
      scopeKind: 'project',
      scopeId: input.projectId,
      mediaType: 'audio',
      schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      name: input.name,
      status: 'pending',
      originKey: `voice-test:${id}`,
    },
  })
  return id
}

async function completeVoiceResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
  readonly payload: ReturnType<typeof buildVoicePayload>
}) {
  const taskId = `voice-task-${randomUUID()}`
  await createQueuedTask({
    id: taskId,
    userId: input.userId,
    projectId: input.projectId,
    type: TASK_TYPE.CREATIVE_RESOURCE_VOICE,
    targetType: 'CreativeResource',
    targetId: input.resourceId,
    operationId: 'generate_voice',
    payload: input.payload,
  })
  const media = await prisma.mediaObject.create({
    data: {
      publicId: `voice-test-${randomUUID()}`,
      storageKey: `voice-test/${randomUUID()}.wav`,
      mimeType: 'audio/wav',
    },
  })
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'completed', finishedAt: new Date() },
  })
  const result = await prisma.$transaction(async (tx) =>
    await materializeCreativeResourceTaskTerminalInTransaction(tx, {
      kind: 'completed',
      task: {
        id: taskId,
        userId: input.userId,
        projectId: input.projectId,
        episodeId: null,
        type: TASK_TYPE.CREATIVE_RESOURCE_VOICE,
        targetType: 'CreativeResource',
        targetId: input.resourceId,
        payload: input.payload,
        operationId: 'generate_voice',
        operationExecutionId: null,
      },
      result: {
        mediaId: media.id,
        modelKey: PLATFORM_VOICE_DESIGN_MODEL_KEY,
      },
      errorCode: null,
      errorMessage: null,
    }))
  if (!result) throw new Error('VOICE_TEST_MATERIALIZATION_RESULT_REQUIRED')
  return { result, mediaId: media.id }
}

describe('Creative Resource character voice lifecycle', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  it('preserves a late voice revision without overwriting a newer binding and only deletes unbound voices', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const character = await prisma.projectCharacter.create({
      data: { projectId: project.id, name: 'Voice binding character' },
    })

    const originalId = await reserveVoiceResource({
      userId: user.id,
      projectId: project.id,
      name: 'Original voice',
    })
    const original = await completeVoiceResource({
      userId: user.id,
      projectId: project.id,
      resourceId: originalId,
      payload: buildVoicePayload(originalId, {
        characterId: character.id,
        expectedVersion: null,
      }),
    })
    expect(original.result.bindingResult).toMatchObject({ status: 'bound' })

    const lateId = await reserveVoiceResource({
      userId: user.id,
      projectId: project.id,
      name: 'Late voice',
    })
    const latePayload = buildVoicePayload(lateId, {
      characterId: character.id,
      expectedVersion: 0,
    })

    const manualId = await reserveVoiceResource({
      userId: user.id,
      projectId: project.id,
      name: 'Manual voice',
    })
    const manual = await completeVoiceResource({
      userId: user.id,
      projectId: project.id,
      resourceId: manualId,
      payload: buildVoicePayload(manualId),
    })
    const manualRevisionId = String(manual.result.revisionId)
    const newerBinding = await prisma.$transaction(async (tx) =>
      await bindCharacterVoiceInTransaction(tx, {
        userId: user.id,
        projectId: project.id,
        characterId: character.id,
        selection: {
          kind: 'voice',
          resourceId: manualId,
          revisionId: manualRevisionId,
        },
      }))
    expect(newerBinding).toMatchObject({ resourceId: manualId, version: 1 })

    const late = await completeVoiceResource({
      userId: user.id,
      projectId: project.id,
      resourceId: lateId,
      payload: latePayload,
    })
    expect(late.result).toMatchObject({
      resourceId: lateId,
      resourceStatus: 'ready',
      bindingResult: { status: 'conflict', binding: null },
    })
    await expect(prisma.creativeResourceBinding.findFirstOrThrow({
      where: {
        role: CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
        slotKey: character.id,
      },
    })).resolves.toMatchObject({ resourceId: manualId, version: 1 })

    await expect(prisma.$transaction(async (tx) =>
      await deleteVoiceResourceInTransaction(tx, {
        userId: user.id,
        projectId: project.id,
        resourceId: manualId,
      }))).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { code: 'VOICE_RESOURCE_STILL_BOUND' },
    })

    await prisma.$transaction(async (tx) =>
      await deleteVoiceResourceInTransaction(tx, {
        userId: user.id,
        projectId: project.id,
        resourceId: lateId,
      }))
    await expect(prisma.creativeResource.findUnique({ where: { id: lateId } })).resolves.toBeNull()
    await expect(prisma.mediaObject.findUnique({ where: { id: late.mediaId } })).resolves.not.toBeNull()
  })
})
