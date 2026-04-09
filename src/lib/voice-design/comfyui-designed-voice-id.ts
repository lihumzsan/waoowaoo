export const COMFYUI_DESIGNED_VOICE_ID_PREFIX = 'comfyui:'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isComfyUiDesignedVoiceId(value: string | null | undefined): boolean {
  return readTrimmedString(value).startsWith(COMFYUI_DESIGNED_VOICE_ID_PREFIX)
}
