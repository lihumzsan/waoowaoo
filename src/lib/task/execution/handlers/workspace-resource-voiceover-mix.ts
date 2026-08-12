import type { TaskExecutionContext } from '../context'
import { parseWorkspaceResourceVoiceoverMixTaskPayload } from '@/lib/workspace-resource/voiceover-contract'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { muxVoiceoverVideo } from '@/lib/video-compose/voiceover-mix'
import { createFfmpegCommandRunner, probeMediaDurationSeconds } from '@/lib/video-compose/ffmpeg-command'
import { validateVoiceoverTimeline } from '@/lib/video-compose/voiceover-timeline'
import { reportTaskProgress } from '../progress'
import { assertTaskActive } from '../provider-media'

export async function handleWorkspaceResourceVoiceoverMixTask(context: TaskExecutionContext) {
  const { data } = context
  const payload = parseWorkspaceResourceVoiceoverMixTaskPayload(data.payload)
  if (data.targetType !== 'WorkspaceResource' || payload.resource.resourceId !== data.targetId) {
    throw new Error(`WORKSPACE_RESOURCE_VOICEOVER_MIX_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const { source, narrations: narrationRefs, bgm } = payload.inputAggregate
  const [resolvedSource] = await resolveWorkspaceResourceInputMedia({ userId: data.userId, projectId: data.projectId, references: [source], expectedMediaType: 'video' })
  const resolvedNarration = await resolveWorkspaceResourceInputMedia({ userId: data.userId, projectId: data.projectId, references: narrationRefs, expectedMediaType: 'audio' })
  const [resolvedBgm] = bgm ? await resolveWorkspaceResourceInputMedia({ userId: data.userId, projectId: data.projectId, references: [bgm], expectedMediaType: 'audio' }) : []
  if (
    !resolvedSource
    || resolvedNarration.some((item) => item.durationMs === null || item.durationMs <= 0)
    || (bgm && (!resolvedBgm || resolvedBgm.durationMs === null || resolvedBgm.durationMs <= 0))
  ) throw new Error(`VOICEOVER_MIX_MEDIA_DURATION_MISSING:${data.taskId}`)
  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-voiceover-${randomUUID()}-`))
  try {
    await reportTaskProgress(context, 10, { stage: 'voiceover_mix_prepare' })
    const videoPath = path.join(workspaceDir, 'source.mp4')
    await writeFile(videoPath, await getObjectBuffer(resolvedSource.storageKey))
    const narrationPaths: Array<{ path: string; startSeconds: number }> = []
    for (const [index, item] of resolvedNarration.entries()) {
      const narrationPath = path.join(workspaceDir, `narration-${String(index)}.mp3`)
      await writeFile(narrationPath, await getObjectBuffer(item.storageKey))
      const ref = narrationRefs[index]
      if (!ref) throw new Error(`VOICEOVER_MIX_START_MISSING:${data.taskId}`)
      narrationPaths.push({ path: narrationPath, startSeconds: ref.startSeconds })
    }
    const durationSeconds = await probeMediaDurationSeconds(videoPath, 'voiceover_mix_probe_video_duration')
    validateVoiceoverTimeline({ videoDurationMs: durationSeconds * 1000, items: resolvedNarration.map((item, index) => ({ resourceId: item.reference.resourceId, startSeconds: narrationPaths[index]!.startSeconds, durationMs: item.durationMs! })) })
    const bgmPath = resolvedBgm ? path.join(workspaceDir, 'bgm.mp3') : undefined
    if (resolvedBgm && bgmPath) await writeFile(bgmPath, await getObjectBuffer(resolvedBgm.storageKey))
    const outputPath = path.join(workspaceDir, 'voiceover.mp4')
    await reportTaskProgress(context, 55, { stage: 'voiceover_mix_render' })
    await muxVoiceoverVideo({ runCommand: createFfmpegCommandRunner({ stage: 'workspace_resource_voiceover_mix', expectedDurationSeconds: durationSeconds }), videoPath, narrationPaths, bgmPath, outputPath, durationSeconds })
    await assertTaskActive(context, 'persist_voiceover_mix')
    const outputBuffer = await readFile(outputPath)
    const storageKey = await uploadObject(outputBuffer, buildTaskArtifactStorageKey({ taskId: data.taskId, artifact: `voiceover-mix:${payload.resource.resourceId}`, extension: 'mp4' }), 'video/mp4')
    const media = await ensureMediaObjectFromStorageKey(storageKey, { mimeType: 'video/mp4', sizeBytes: outputBuffer.byteLength, durationMs: Math.round(durationSeconds * 1000), width: resolvedSource.width, height: resolvedSource.height })
    return { mediaId: media.id, videoUrl: media.url, storageKey, durationMs: Math.round(durationSeconds * 1000), width: resolvedSource.width, height: resolvedSource.height }
  } finally { await rm(workspaceDir, { recursive: true, force: true }) }
}
