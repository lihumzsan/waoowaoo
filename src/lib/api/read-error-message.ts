interface ApiErrorPayload {
  error?: string | { message?: string | null } | null
  message?: string | null
}

export async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as ApiErrorPayload
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return payload.error
    }
    if (payload?.error && typeof payload.error === 'object' && typeof payload.error.message === 'string' && payload.error.message.trim()) {
      return payload.error.message
    }
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return payload.message
    }
  } catch {
    // Keep the explicit fallback when the backend does not return JSON.
  }
  return fallback
}
