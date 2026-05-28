export type BillingMode = 'OFF' | 'SHADOW' | 'ENFORCE'

export async function getBillingMode(): Promise<BillingMode> {
  return 'OFF'
}

export function getBootBillingEnabled() {
  return false
}
