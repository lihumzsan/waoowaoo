const MAX_DEPTH = 6

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

// key 归一化后做子串匹配：去掉所有非字母数字字符，
// 使 api_key / x-api-key / apiKey / Access-Key 等变体都命中同一个 needle。
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function shouldRedact(key: string, redactKeys: string[]): boolean {
  const normalized = normalizeKey(key)
  return redactKeys.some((needle) => normalized.includes(normalizeKey(needle)))
}

export function redactValue(value: unknown, redactKeys: string[], depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MaxDepth]'
  if (value == null) return value

  if (value instanceof Date) return value

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactKeys, depth + 1))
  }

  if (isRecordLike(value)) {
    // 类实例（Headers、请求配置等）同样按可枚举自有属性递归，
    // 防止 JSON.stringify 把未脱敏的内部字段原样序列化。
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      if (shouldRedact(key, redactKeys)) {
        output[key] = '[REDACTED]'
      } else {
        output[key] = redactValue(nested, redactKeys, depth + 1)
      }
    }
    return output
  }

  return value
}
