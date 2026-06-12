export async function fetchPublicDeploymentIsCloud(): Promise<boolean> {
  try {
    const response = await fetch('/api/deployment', { cache: 'no-store' })
    if (!response.ok) return false

    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false
    const deployment = Reflect.get(payload, 'deployment')
    if (typeof deployment !== 'object' || deployment === null || Array.isArray(deployment)) return false
    return Reflect.get(deployment, 'isCloud') === true
  } catch {
    return false
  }
}
