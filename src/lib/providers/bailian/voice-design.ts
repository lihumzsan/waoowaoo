export function validateVoicePrompt(voicePrompt: string): { valid: boolean; error?: string } {
  if (!voicePrompt || voicePrompt.trim().length === 0) {
    return { valid: false, error: 'Voice prompt is required' }
  }
  if (voicePrompt.length > 500) {
    return { valid: false, error: 'Voice prompt must be 500 characters or fewer' }
  }
  return { valid: true }
}

export function validatePreviewText(previewText: string): { valid: boolean; error?: string } {
  if (!previewText || previewText.trim().length === 0) {
    return { valid: false, error: 'Preview text is required' }
  }
  if (previewText.length < 5) {
    return { valid: false, error: 'Preview text must be at least 5 characters' }
  }
  if (previewText.length > 200) {
    return { valid: false, error: 'Preview text must be 200 characters or fewer' }
  }
  return { valid: true }
}
