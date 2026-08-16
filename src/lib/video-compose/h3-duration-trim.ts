import { probeMediaDurationSeconds, runFfmpegCommand } from './ffmpeg-command'

function formatDurationSeconds(value: number): string {
  if (!Number.isInteger(value) || value < 4 || value > 15) {
    throw new Error(`H3_REQUESTED_DURATION_INVALID:${String(value)}`)
  }
  return value.toFixed(3)
}

export async function trimH3VideoToRequestedDuration(input: {
  readonly inputPath: string
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<number> {
  const durationSeconds = formatDurationSeconds(input.durationSeconds)
  await runFfmpegCommand('ffmpeg', [
    '-y',
    '-i', input.inputPath,
    '-filter_complex', `[0:v:0]trim=duration=${durationSeconds},setpts=PTS-STARTPTS[v];[0:a:0]atrim=duration=${durationSeconds},asetpts=PTS-STARTPTS[a]`,
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
    stage: 'h3_exact_duration_trim',
    expectedDurationSeconds: input.durationSeconds,
  })
  const actualDurationSeconds = await probeMediaDurationSeconds(input.outputPath, 'h3_exact_duration_probe')
  if (Math.abs(actualDurationSeconds - input.durationSeconds) > 0.05) {
    throw new Error(`H3_FINAL_DURATION_MISMATCH:${String(input.durationSeconds)}:${String(actualDurationSeconds)}`)
  }
  return actualDurationSeconds
}
