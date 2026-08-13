import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { probeMediaDurationSeconds, runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'
import { extensionFromAudioMimeType } from './audio'

export type MusicArtifactPlan = {
  readonly requestedDurationSeconds: number
  readonly providerDurationSeconds: number
  readonly requiresTrim: boolean
  readonly fadeDurationSeconds: number
  readonly fadeStartSeconds: number
}

export function resolveMusicArtifactPlan(input: {
  readonly requestedDurationSeconds: number
  readonly providerDurationSeconds: number
}): MusicArtifactPlan {
  if (!Number.isInteger(input.requestedDurationSeconds) || input.requestedDurationSeconds <= 0) {
    throw new Error('MUSIC_ARTIFACT_REQUESTED_DURATION_INVALID')
  }
  if (!Number.isInteger(input.providerDurationSeconds) || input.providerDurationSeconds < input.requestedDurationSeconds) {
    throw new Error('MUSIC_ARTIFACT_PROVIDER_DURATION_INVALID')
  }
  const requiresTrim = input.providerDurationSeconds > input.requestedDurationSeconds
  const fadeDurationSeconds = requiresTrim
    ? Math.min(0.8, Math.max(0.3, input.requestedDurationSeconds / 8))
    : 0
  return {
    ...input,
    requiresTrim,
    fadeDurationSeconds,
    fadeStartSeconds: input.requestedDurationSeconds - fadeDurationSeconds,
  }
}

export async function materializeGeneratedMusic(input: {
  readonly buffer: Buffer
  readonly mimeType: string
  readonly requestedDurationSeconds: number
  readonly providerDurationSeconds: number
}): Promise<{
  readonly buffer: Buffer
  readonly mimeType: string
  readonly durationMs: number
  readonly plan: MusicArtifactPlan
}> {
  const plan = resolveMusicArtifactPlan({
    requestedDurationSeconds: input.requestedDurationSeconds,
    providerDurationSeconds: input.providerDurationSeconds,
  })
  const workspaceDirectory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-music-artifact-'))
  try {
    const sourcePath = path.join(workspaceDirectory, `source.${extensionFromAudioMimeType(input.mimeType)}`)
    await writeFile(sourcePath, input.buffer)
    let artifactPath = sourcePath
    let buffer = input.buffer
    let mimeType = input.mimeType
    if (plan.requiresTrim) {
      artifactPath = path.join(workspaceDirectory, 'trimmed.mp3')
      await runFfmpegCommand('ffmpeg', [
        '-y',
        '-i',
        sourcePath,
        '-af',
        `atrim=start=0:end=${plan.requestedDurationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${plan.fadeStartSeconds.toFixed(3)}:d=${plan.fadeDurationSeconds.toFixed(3)}`,
        '-t',
        plan.requestedDurationSeconds.toFixed(3),
        '-c:a',
        'libmp3lame',
        '-q:a',
        '0',
        artifactPath,
      ], {
        stage: 'workspace_resource_music_short_cue_trim',
        expectedDurationSeconds: plan.requestedDurationSeconds,
      })
      buffer = await readFile(artifactPath)
      mimeType = 'audio/mpeg'
    }
    const durationSeconds = await probeMediaDurationSeconds(
      artifactPath,
      'workspace_resource_music_probe_duration',
    )
    if (plan.requiresTrim && durationSeconds > plan.requestedDurationSeconds + 0.1) {
      throw new Error(`MUSIC_ARTIFACT_TRIM_DURATION_EXCEEDED:${durationSeconds.toFixed(3)}`)
    }
    return {
      buffer,
      mimeType,
      durationMs: Math.round(durationSeconds * 1000),
      plan,
    }
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true })
  }
}
