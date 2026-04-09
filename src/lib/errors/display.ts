import { resolveUnifiedErrorCode } from './codes'
import { getUserMessageByCode } from './user-messages'
import { normalizeAnyError } from './normalize'

function extractComfyUiWorkflowDisplay(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  if (!raw.toLowerCase().includes('comfyui_workflow_not_found')) return null

  const workflowMatch = raw.match(/COMFYUI_WORKFLOW_NOT_FOUND:\s*([^,\n]+)/i)
  const workflowId = workflowMatch?.[1]?.trim()

  if (workflowId) {
    return `\u672a\u627e\u5230\u672c\u5730 ComfyUI \u5de5\u4f5c\u6d41\u3002\u8bf7\u68c0\u67e5 COMFYUI_WORKFLOW_ROOT \u6216\u5de5\u4f5c\u6d41\u76ee\u5f55\u3002\u7f3a\u5c11\u5de5\u4f5c\u6d41\uff1a${workflowId}.json`
  }

  return '\u672a\u627e\u5230\u672c\u5730 ComfyUI \u5de5\u4f5c\u6d41\u3002\u8bf7\u68c0\u67e5 COMFYUI_WORKFLOW_ROOT \u6216\u5de5\u4f5c\u6d41\u76ee\u5f55\u3002'
}

function extractProviderDetail(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null

  const comfyUiDetail = extractComfyUiWorkflowDisplay(raw)
  if (comfyUiDetail) return comfyUiDetail

  const jsonMatch = raw.match(/\{.*"message"\s*:\s*"([^"]+)"/)
  if (jsonMatch?.[1]) return jsonMatch[1]

  const cleaned = raw
    .replace(/^\[[\w\s]+\]\s*/g, '')
    .replace(/^[\w\s]+\u5931\u8d25:\s*/g, '')
    .replace(/^\d{3}\s*-\s*/g, '')
    .trim()

  return cleaned || null
}

export function resolveErrorDisplay(input?: {
  code?: string | null
  message?: string | null
} | null) {
  if (!input) return null
  if (!input.code && !input.message) return null

  const comfyUiDisplay = extractComfyUiWorkflowDisplay(input.message)
  if (comfyUiDisplay) {
    return {
      code: 'MISSING_CONFIG',
      message: comfyUiDisplay,
    }
  }

  const code = resolveUnifiedErrorCode(input.code)
  if (code && code !== 'INTERNAL_ERROR') {
    const userMessage = getUserMessageByCode(code)
    if (code === 'VIDEO_API_FORMAT_UNSUPPORTED') {
      return {
        code,
        message: userMessage,
      }
    }

    const detail = extractProviderDetail(input.message)
    return {
      code,
      message: detail ? `${userMessage}\n${detail}` : userMessage,
    }
  }

  const normalized = normalizeAnyError(
    { code: input.code || undefined, message: input.message || undefined },
    { context: 'api' },
  )

  if (normalized?.code) {
    const userMessage = getUserMessageByCode(normalized.code)
    const detail = extractProviderDetail(input.message)
    return {
      code: normalized.code,
      message: detail ? `${userMessage}\n${detail}` : userMessage,
    }
  }

  return null
}
