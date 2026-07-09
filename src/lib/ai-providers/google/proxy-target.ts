export const GOOGLE_PROVIDER_PROXY_TARGET = 'https://generativelanguage.googleapis.com'

export function resolveGoogleProviderProxyTarget(baseUrl?: string): string {
  return baseUrl?.trim() || GOOGLE_PROVIDER_PROXY_TARGET
}
