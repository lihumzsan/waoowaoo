import {
  H3_CONTINUATION_GUIDE_FRAMES,
  H3_CONTINUATION_GUIDE_SECONDS,
} from '@/lib/video-generation/h3-timeline'
import { probeMediaDurationSeconds, runFfmpegCommand } from './ffmpeg-command'

const H3_CONTINUATION_DELIVERY_DURATION_TOLERANCE_SECONDS = 0.08

export async function removeH3ContinuationGuide(input: {
  readonly inputPath: string
  readonly outputPath: string
}): Promise<number> {
  const sourceDurationSeconds = await probeMediaDurationSeconds(
    input.inputPath,
    'h3_continuation_delivery_source_probe',
  )
  const expectedDurationSeconds = sourceDurationSeconds - H3_CONTINUATION_GUIDE_SECONDS
  if (expectedDurationSeconds <= 0) {
    throw new Error(`H3_CONTINUATION_DELIVERY_TOO_SHORT:${String(sourceDurationSeconds)}`)
  }

  await runFfmpegCommand('ffmpeg', [
    '-y',
    '-i', input.inputPath,
    '-filter_complex',
    `[0:v:0]trim=start_frame=${String(H3_CONTINUATION_GUIDE_FRAMES)},setpts=PTS-STARTPTS[v];[0:a:0]atrim=start=${H3_CONTINUATION_GUIDE_SECONDS.toFixed(6)},asetpts=PTS-STARTPTS[a]`,
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
    stage: 'h3_continuation_delivery_remove_guide',
    expectedDurationSeconds: sourceDurationSeconds,
  })

  const outputDurationSeconds = await probeMediaDurationSeconds(
    input.outputPath,
    'h3_continuation_delivery_output_probe',
  )
  if (
    Math.abs(outputDurationSeconds - expectedDurationSeconds)
    > H3_CONTINUATION_DELIVERY_DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `H3_CONTINUATION_DELIVERY_DURATION_MISMATCH:${String(expectedDurationSeconds)}:${String(outputDurationSeconds)}`,
    )
  }
  return outputDurationSeconds
}
