type ProviderAsyncTaskStatusFields = {
  imageUrl?: string
  videoUrl?: string
  actualVideoTokens?: number
  error?: string
}

export type ProviderAsyncTaskStatus = ProviderAsyncTaskStatusFields & (
  | {
    status: 'pending' | 'completed'
    failureDisposition?: never
  }
  | {
    status: 'failed'
    failureDisposition: 'retryable' | 'permanent'
  }
)
