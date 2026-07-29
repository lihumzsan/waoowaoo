export function isSecurityBrowserNetworkAllowed(rawUrl: string): boolean {
  const url = new URL(rawUrl)
  return url.protocol === 'data:'
    || url.protocol === 'blob:'
    || url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
}
