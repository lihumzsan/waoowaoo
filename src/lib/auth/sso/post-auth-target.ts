const AUTHORIZE_PATH = '/api/auth/sso/authorize'

export function parseSsoPostAuthTarget(value: string | null): string | null {
  if (!value || !value.startsWith(`${AUTHORIZE_PATH}?`)) return null
  let parsed: URL
  try {
    parsed = new URL(value, 'https://wao.invalid')
  } catch {
    return null
  }
  if (parsed.origin !== 'https://wao.invalid' || parsed.pathname !== AUTHORIZE_PATH || parsed.hash) return null
  return `${parsed.pathname}${parsed.search}`
}
