export type BailianProviderKey = 'bailian'

export interface BailianGenerateRequestOptions {
  provider: string
  modelId: string
  modelKey: string
  [key: string]: unknown
}

export interface BailianLlmMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type BailianProbeStepName = 'models' | 'textGen' | 'credits'

export interface BailianProbeStep {
  name: BailianProbeStepName
  status: 'pass' | 'fail' | 'skip'
  message: string
  model?: string
  detail?: string
}

export interface BailianProbeResult {
  success: boolean
  steps: BailianProbeStep[]
  model?: string
  answer?: string
}
