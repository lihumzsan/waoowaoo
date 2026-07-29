import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  parseCreativeResourceGenerationTaskPayload,
} from '@/lib/creative-resource/generation-contract'
import { buildCreativeResourceId } from '@/lib/creative-resource/identity'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { deleteObject, uploadObject } from '@/lib/storage'
import { loadVideoAudioReferences } from '@/lib/workers/handlers/creative-resource-video'
import { resetSystemState } from '../../helpers/db-reset'
import { createFixtureProject, createFixtureUser } from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'

const WAV_FIXTURE = Buffer.from([
  0x52, 0x49, 0x46, 0x46,
  0x04, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45,
  0x00, 0x01, 0x02, 0x03,
])

describe('Creative Resource video reference audio outbound media', () => {
  const storageKeys: string[] = []

  beforeEach(async () => {
    await resetSystemState()
  })

  afterEach(async () => {
    for (const storageKey of storageKeys.splice(0)) {
      await deleteObject(storageKey)
    }
  })

  it('reads an owned audio Resource from storage and emits a provider-ready data URL', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const storageKey = `test/video-reference-audio/${randomUUID()}.wav`
    storageKeys.push(storageKey)
    await uploadObject(WAV_FIXTURE, storageKey, 1, 'audio/wav')
    const media = await ensureMediaObjectFromStorageKey(storageKey, {
      mimeType: 'audio/wav',
      sizeBytes: WAV_FIXTURE.byteLength,
    })
    const audioResourceId = buildCreativeResourceId({
      operationId: 'generate_voice',
      requestId: randomUUID(),
      candidateIndex: 0,
    })
    await prisma.creativeResource.create({
      data: {
        id: audioResourceId,
        userId: user.id,
        projectId: project.id,
        episodeId: null,
        scopeKind: 'project',
        scopeId: project.id,
        mediaType: 'audio',
        schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        name: 'Reference voice',
        status: 'ready',
        mediaId: media.id,
      },
    })
    const outputResourceId = buildCreativeResourceId({
      operationId: 'create_video',
      requestId: randomUUID(),
      candidateIndex: 0,
    })
    const payload = parseCreativeResourceGenerationTaskPayload({
      lifecycleProjection: {
        resources: [{
          resourceId: outputResourceId,
          mediaType: 'video',
          schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
          name: 'Video',
        }],
      },
      resource: {
        resourceId: outputResourceId,
        mediaType: 'video',
        schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        prompt: 'Use the supplied image and reference voice.',
        modelKey: 'openrouter::bytedance/seedance-2.0-fast',
        inputHash: randomUUID().replaceAll('-', ''),
        inputs: [{
          resourceId: audioResourceId,
          role: 'character_voice',
          position: 0,
        }],
        imageInputPositions: [],
        audioInputPositions: [0],
        videoInputPositions: [],
        generationOptions: {},
        executionSegmentId: null,
        toolCallId: null,
      },
      videoModel: 'openrouter::bytedance/seedance-2.0-fast',
      count: 1,
      generationOptions: {},
    })

    await expect(loadVideoAudioReferences(user.id, payload)).resolves.toEqual([
      `data:audio/wav;base64,${WAV_FIXTURE.toString('base64')}`,
    ])

    const foreignUser = await createFixtureUser()
    await expect(loadVideoAudioReferences(foreignUser.id, payload)).rejects.toThrow(
      `CREATIVE_RESOURCE_INPUT_CHANGED:${audioResourceId}`,
    )
  })
})
