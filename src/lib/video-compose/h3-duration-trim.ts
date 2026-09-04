import { probeMediaDurationSeconds, runFfmpegCommand } from './ffmpeg-command'
import {
  H3_CONTINUATION_GUIDE_FRAMES,
  H3_FRAMES_PER_SECOND,
} from '@/lib/video-generation/h3-timeline'

export type H3VideoTimelinePolicy =
  | 'trim'
  | 'retime'
  | 'drop_guide_then_trim'

function formatDurationSeconds(value: number): string {
  if (!Number.isInteger(value) || value < 4 || value > 15) {
    throw new Error(`H3_REQUESTED_DURATION_INVALID:${String(value)}`)
  }
  return value.toFixed(3)
}

function timelineFilter(input: {
  readonly policy: H3VideoTimelinePolicy
  readonly sourceVideoDurationSeconds: number
  readonly sourceAudioDurationSeconds: number
  readonly targetDurationSeconds: number
}): string {
  const target = input.targetDurationSeconds.toFixed(6)
  if (input.policy === 'trim') {
    return `[0:v:0]trim=duration=${target},setpts=PTS-STARTPTS[v];[0:a:0]atrim=duration=${target},asetpts=PTS-STARTPTS[a]`
  }
  if (input.policy === 'drop_guide_then_trim') {
    const guideSeconds = H3_CONTINUATION_GUIDE_FRAMES / H3_FRAMES_PER_SECOND
    return `[0:v:0]trim=start_frame=${String(H3_CONTINUATION_GUIDE_FRAMES)},setpts=PTS-STARTPTS,trim=duration=${target},setpts=PTS-STARTPTS[v];[0:a:0]atrim=start=${guideSeconds.toFixed(6)},asetpts=PTS-STARTPTS,atrim=duration=${target},asetpts=PTS-STARTPTS[a]`
  }
  const videoScale = input.targetDurationSeconds / input.sourceVideoDurationSeconds
  const audioTempo = input.sourceAudioDurationSeconds / input.targetDurationSeconds
  return `[0:v:0]setpts=${videoScale.toFixed(9)}*PTS,fps=${String(H3_FRAMES_PER_SECOND)},trim=duration=${target},setpts=PTS-STARTPTS[v];[0:a:0]atempo=${audioTempo.toFixed(9)},atrim=duration=${target},asetpts=PTS-STARTPTS[a]`
}

async function probeStreamDurationSeconds(
  filePath: string,
  streamSelector: 'v:0' | 'a:0',
  stage: string,
): Promise<number> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v', 'error',
    '-select_streams', streamSelector,
    '-show_entries', 'stream=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { stage })
  const duration = Number.parseFloat(result.stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`H3_STREAM_DURATION_INVALID:${streamSelector}`)
  }
  return duration
}

export async function processH3VideoTimeline(input: {
  readonly inputPath: string
  readonly outputPath: string
  readonly durationSeconds: number
  readonly policy: H3VideoTimelinePolicy
}): Promise<number> {
  formatDurationSeconds(input.durationSeconds)
  const sourceVideoDurationSeconds = await probeStreamDurationSeconds(
    input.inputPath,
    'v:0',
    'h3_timeline_source_video_duration_probe',
  )
  const sourceAudioDurationSeconds = await probeStreamDurationSeconds(
    input.inputPath,
    'a:0',
    'h3_timeline_source_audio_duration_probe',
  )
  await runFfmpegCommand('ffmpeg', [
    '-y',
    '-i', input.inputPath,
    '-filter_complex', timelineFilter({
      policy: input.policy,
      sourceVideoDurationSeconds,
      sourceAudioDurationSeconds,
      targetDurationSeconds: input.durationSeconds,
    }),
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '10',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    input.outputPath,
  ], {
    stage: `h3_timeline_${input.policy}`,
    expectedDurationSeconds: input.durationSeconds,
  })
  const actualDurationSeconds = await probeMediaDurationSeconds(input.outputPath, 'h3_timeline_output_probe')
  const [actualVideoDurationSeconds, actualAudioDurationSeconds] = await Promise.all([
    probeStreamDurationSeconds(input.outputPath, 'v:0', 'h3_timeline_output_video_probe'),
    probeStreamDurationSeconds(input.outputPath, 'a:0', 'h3_timeline_output_audio_probe'),
  ])
  if (
    Math.abs(actualDurationSeconds - input.durationSeconds) > 0.05
    || Math.abs(actualVideoDurationSeconds - input.durationSeconds) > 0.05
    || Math.abs(actualAudioDurationSeconds - input.durationSeconds) > 0.05
  ) {
    throw new Error(`H3_FINAL_DURATION_MISMATCH:${String(input.durationSeconds)}:${String(actualDurationSeconds)}`)
  }
  return actualDurationSeconds
}
