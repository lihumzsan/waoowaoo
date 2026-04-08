export const BAILIAN_STANDARD_COMPAT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const BAILIAN_CODING_COMPAT_BASE_URL = 'https://coding.dashscope.aliyuncs.com/v1'

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined
}

export function isBailianCodingPlanApiKey(apiKey?: string): boolean {
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : ''
  return trimmed.startsWith('sk-sp-')
}

export function resolveBailianCompatibleBaseUrl(params: {
  apiKey?: string
  baseUrl?: string
}): string {
  const manualBaseUrl = normalizeBaseUrl(params.baseUrl)
  if (manualBaseUrl) return manualBaseUrl
  return isBailianCodingPlanApiKey(params.apiKey)
    ? BAILIAN_CODING_COMPAT_BASE_URL
    : BAILIAN_STANDARD_COMPAT_BASE_URL
}

export function buildBailianCompatibleUrl(
  params: {
    apiKey?: string
    baseUrl?: string
  },
  path: string,
): string {
  const normalizedPath = path.trim().replace(/^\/+/, '')
  return `${resolveBailianCompatibleBaseUrl(params)}/${normalizedPath}`
}
