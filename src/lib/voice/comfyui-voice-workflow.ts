const COMFYUI_SINGLE_VOICE_WORKFLOW_FALLBACKS: Record<string, string> = {
  'baseaudio/多人/LongCat-two': 'baseaudio/单人/LongCat-one',
  'baseaudio/多人/s2-two': 'baseaudio/单人/s2-one',
  'baseaudio/三人/s2-three': 'baseaudio/单人/s2-one',
}

export function resolveComfyUiSingleVoiceWorkflowKey(modelId: string): string {
  const normalized = modelId.trim()
  return COMFYUI_SINGLE_VOICE_WORKFLOW_FALLBACKS[normalized] || normalized
}
