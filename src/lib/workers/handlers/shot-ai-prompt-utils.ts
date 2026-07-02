export type AnyObj = Record<string, unknown>

export function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function readRequiredString(value: unknown, field: string): string {
  const text = readText(value).trim()
  if (!text) {
    throw new Error(`${field} is required`)
  }
  return text
}

export function parseShotPromptResponse(direct: AnyObj): {
  imagePrompt: string
  videoPrompt: string
} {
  try {
    if (typeof direct.image_prompt === 'string' && direct.image_prompt.trim()) {
      return {
        imagePrompt: direct.image_prompt.trim(),
        videoPrompt: typeof direct.video_prompt === 'string' ? direct.video_prompt.trim() : '',
      }
    }
    if (typeof direct.prompt === 'string' && direct.prompt.trim()) {
      return {
        imagePrompt: direct.prompt.trim(),
        videoPrompt: '',
      }
    }
  } catch { }
  throw new Error('Invalid shot prompt response')
}
