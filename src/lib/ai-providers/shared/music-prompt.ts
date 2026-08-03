import type { AiReadonlyUnknownObject } from '@/lib/ai-registry/types'

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Canonical product music fields compiled once into the provider prompt. */
export function compileMusicPrompt(
  prompt: string,
  options: AiReadonlyUnknownObject,
): string {
  const lines = [prompt.trim()]
  const genre = trimmedString(options.genre)
  const mood = trimmedString(options.mood)
  if (genre) lines.push(`Genre: ${genre}`)
  if (mood) lines.push(`Mood: ${mood}`)
  if (typeof options.durationSeconds === 'number') {
    lines.push(`Target duration: ${String(options.durationSeconds)} seconds`)
  }
  if (typeof options.bpm === 'number') lines.push(`BPM: ${String(options.bpm)}`)
  if (options.vocalMode === 'instrumental') {
    lines.push('Instrumental only. Do not include vocals or lyrics.')
  }
  if (options.vocalMode === 'vocal') {
    lines.push('Vocals are allowed when musically appropriate.')
  }
  const outputFormat = trimmedString(options.outputFormat)
  if (outputFormat) lines.push(`Output format: ${outputFormat}`)
  return lines.join('\n')
}
