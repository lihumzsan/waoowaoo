import type { FfmpegCommandRunner } from './ffmpeg-command'

async function hasAudioStream(runCommand: FfmpegCommandRunner, filePath: string): Promise<boolean> {
  const result = await runCommand('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath])
  return result.stdout.trim().length > 0
}

function duration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error('VOICEOVER_MIX_DURATION_INVALID')
  return value.toFixed(3)
}

export async function muxVoiceoverVideo(input: {
  readonly runCommand: FfmpegCommandRunner
  readonly videoPath: string
  readonly narrationPaths: readonly { path: string; startSeconds: number }[]
  readonly bgmPath?: string
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  const durationSeconds = duration(input.durationSeconds)
  const sourceHasAudio = await hasAudioStream(input.runCommand, input.videoPath)
  const audioInputs = [input.videoPath, ...input.narrationPaths.map((item) => item.path), ...(input.bgmPath ? [input.bgmPath] : [])]
  const args = ['-y', ...audioInputs.flatMap((file) => ['-i', file])]
  const filters: string[] = []
  if (sourceHasAudio) filters.push('[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[source]')
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${durationSeconds}[source]`)
  const narrationLabels: string[] = []
  for (const [index, item] of input.narrationPaths.entries()) {
    const inputIndex = index + 1
    const label = `narration${String(index)}`
    const delay = Math.max(0, Math.round(item.startSeconds * 1000))
    filters.push(`[${String(inputIndex)}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${String(delay)}|${String(delay)},apad=whole_dur=${durationSeconds},atrim=0:${durationSeconds},asetpts=PTS-STARTPTS,volume=1.15[${label}]`)
    narrationLabels.push(`[${label}]`)
  }
  const narrationBus = '[narrationbus]'
  filters.push(`${narrationLabels.join('')}amix=inputs=${String(narrationLabels.length)}:duration=longest:dropout_transition=0,alimiter=limit=0.95${narrationBus}`)
  const mixInputs: string[] = []
  if (sourceHasAudio) {
    filters.push(`[source]${narrationBus}sidechaincompress=threshold=0.08:ratio=4:attack=20:release=350[sourceDuck]`)
    mixInputs.push('[sourceDuck]')
  } else {
    mixInputs.push('[source]')
  }
  mixInputs.push(narrationBus)
  if (input.bgmPath) {
    const bgmIndex = input.narrationPaths.length + 1
    filters.push(`[${String(bgmIndex)}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${durationSeconds},apad=whole_dur=${durationSeconds},volume=0.22[bgm]`)
    filters.push(`[bgm]${narrationBus}sidechaincompress=threshold=0.06:ratio=5:attack=30:release=450[bgmDuck]`)
    mixInputs.push('[bgmDuck]')
  }
  filters.push(`${mixInputs.join('')}amix=inputs=${String(mixInputs.length)}:duration=first:dropout_transition=0,alimiter=limit=0.95[aout]`)
  args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', durationSeconds, input.outputPath)
  await input.runCommand('ffmpeg', args)
}
