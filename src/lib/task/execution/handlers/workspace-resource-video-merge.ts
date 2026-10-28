import {
  COMPOSITION_TARGETS,
  validateCompositionTarget,
} from '@/lib/video-compose/composition-target-registry'
import { exportJianyingProject } from '@/lib/jianying/export-project'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseWorkspaceResourceVideoMergeTaskPayload } from '@/lib/workspace-resource/video-merge-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { renderMp4Composition } from '@/lib/video-compose/render-mp4-composition'
import type { CompositionTarget } from '@/lib/video-compose/composition-contract'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive } from '../provider-media'

type CompositionArtifact = {
  buffer: Buffer
  width: number | null
  height: number | null
  durationMs: number | null
}

export async function handleWorkspaceResourceVideoMergeTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceVideoMergeTaskPayload(
    data.payload ?? {},
  )
  if (payload.resource.resourceId !== data.targetId) {
    throw new Error(
      `WORKSPACE_RESOURCE_VIDEO_MERGE_TARGET_MISMATCH:${data.taskId}`,
    )
  }
  const videoInputs = payload.resource.inputs.filter(
    (input) => input.role === 'source_video',
  )
  const resolvedVideos = await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: videoInputs,
    expectedMediaType: 'video',
  })
  const ordered = resolvedVideos.map((resource) => ({
    input: resource.reference,
    storageKey: resource.storageKey,
  }))
  const assemblyAudioInput =
    payload.resource.inputs.find(
      (input) =>
        input.role === 'background_music' || input.role === 'replacement_audio',
    ) ?? null
  const [resolvedAssemblyAudio] = assemblyAudioInput
    ? await resolveWorkspaceResourceInputMedia({
        userId: data.userId,
        projectId: data.projectId,
        references: [assemblyAudioInput],
        expectedMediaType: 'audio',
      })
    : []
  const assemblyAudioStorageKey = resolvedAssemblyAudio?.storageKey ?? null
  const recipe = payload.resource.generationOptions
  const { composition, outputTarget, sourceFacts, jianyingProfile } = recipe
  validateCompositionTarget(outputTarget, composition)
  const target = COMPOSITION_TARGETS[outputTarget]
  const inputByPosition = new Map(
    payload.resource.inputs.map((input) => [input.position, input]),
  )
  const bgmInputs = payload.resource.musicCues.map((cue) => {
    const reference = inputByPosition.get(cue.inputPosition)
    if (!reference || reference.role !== 'bgm_audio') {
      throw new Error(
        `WORKSPACE_RESOURCE_VIDEO_MERGE_BGM_POSITION_INVALID:${String(cue.inputPosition)}`,
      )
    }
    return reference
  })
  const resolvedBgm =
    bgmInputs.length > 0
      ? await resolveWorkspaceResourceInputMedia({
          userId: data.userId,
          projectId: data.projectId,
          references: bgmInputs,
          expectedMediaType: 'audio',
        })
      : []
  const soundInputs = payload.resource.soundCues.map((cue) => {
    const reference = inputByPosition.get(cue.inputPosition)
    if (!reference || reference.role !== 'sound_effect_audio') {
      throw new Error(
        `WORKSPACE_RESOURCE_VIDEO_MERGE_SOUND_POSITION_INVALID:${String(cue.inputPosition)}`,
      )
    }
    return reference
  })
  const resolvedSound =
    soundInputs.length > 0
      ? await resolveWorkspaceResourceInputMedia({
          userId: data.userId,
          projectId: data.projectId,
          references: soundInputs,
          expectedMediaType: 'audio',
        })
      : []

  const workspaceDir = await mkdtemp(
    path.join(tmpdir(), `waoowaoo-resource-merge-${randomUUID()}-`),
  )
  try {
    await reportTaskProgress(context, 10, {
      stage: 'workspace_resource_video_merge_prepare',
    })
    const sourcePaths: string[] = []
    let totalBytes = 0
    const downloadedPaths = new Map<string, string>()
    for (const [index, item] of ordered.entries()) {
      const existing = downloadedPaths.get(item.storageKey)
      if (existing) {
        sourcePaths.push(existing)
        continue
      }
      const sourcePath = path.join(workspaceDir, `source-${String(index)}.mp4`)
      const buffer = await getObjectBuffer(item.storageKey, {
        maxBytes: target.maxInputBytes - totalBytes,
      })
      totalBytes += buffer.length
      await writeFile(sourcePath, buffer)
      downloadedPaths.set(item.storageKey, sourcePath)
      sourcePaths.push(sourcePath)
    }
    await reportTaskProgress(context, 65, {
      stage: 'workspace_resource_video_merge_compose',
    })
    const renderers = {
      mp4: async () =>
        await renderMp4Composition({
          payload,
          sourcePaths,
          workspaceDir,
          assemblyAudioStorageKey,
          resolvedBgm,
          resolvedSound,
        }),
      jianying_project: async () => {
        if (!jianyingProfile) throw new Error('JIANYING_PROFILE_REQUIRED')
        return {
          buffer: await exportJianyingProject({
            identity: data.taskId,
            name: recipe.name,
            locale: recipe.locale,
            composition,
            profile: jianyingProfile,
            sourceFacts,
            format: recipe.format,
            sourcePaths,
            workspaceDir,
          }),
          width: null,
          height: null,
          durationMs: null,
        }
      },
    } satisfies Record<CompositionTarget, () => Promise<CompositionArtifact>>
    const artifact = await renderers[outputTarget]()
    await reportTaskProgress(context, 92, {
      stage: 'workspace_resource_video_merge_persist',
    })
    await assertTaskActive(context, 'persist_workspace_resource_video_merge')
    const storageKey = await uploadObject(
      artifact.buffer,
      buildTaskArtifactStorageKey({
        taskId: data.taskId,
        artifact: `workspace-resource-video-merge:${payload.resource.resourceId}`,
        extension: target.extension,
      }),
      target.mimeType,
    )
    const media = await ensureMediaObjectFromStorageKey(storageKey, {
      mimeType: target.mimeType,
      sizeBytes: artifact.buffer.length,
      width: artifact.width,
      height: artifact.height,
      durationMs: artifact.durationMs,
    })
    return {
      mediaId: media.id,
      storageKey: media.storageKey,
      mediaUrl: media.url,
      durationMs: artifact.durationMs,
      width: artifact.width,
      height: artifact.height,
      clipCount: ordered.length,
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
