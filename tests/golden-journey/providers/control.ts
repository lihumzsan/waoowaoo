import { readFile } from 'node:fs/promises'
import path from 'node:path'

interface GoldenEnvironmentDescriptor {
  readonly providerBaseUrl: string
}

export async function setGoldenForcedTool(forcedToolName: string | null): Promise<void> {
  const descriptor = JSON.parse(await readFile(
    path.resolve(process.cwd(), 'artifacts/golden-journey/environment.json'),
    'utf8',
  )) as GoldenEnvironmentDescriptor
  const response = await fetch(`${descriptor.providerBaseUrl}/__golden/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ forcedToolName }),
  })
  if (!response.ok) throw new Error(`GOLDEN_PROVIDER_CONTROL_HTTP_${String(response.status)}`)
}

export async function setGoldenStreamPacing(
  streamPacing: { readonly chunkSize: number; readonly delayMs: number } | null,
): Promise<void> {
  const descriptor = JSON.parse(await readFile(
    path.resolve(process.cwd(), 'artifacts/golden-journey/environment.json'),
    'utf8',
  )) as GoldenEnvironmentDescriptor
  const response = await fetch(`${descriptor.providerBaseUrl}/__golden/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ streamPacing }),
  })
  if (!response.ok) throw new Error(`GOLDEN_PROVIDER_CONTROL_HTTP_${String(response.status)}`)
}

export async function setGoldenMediaScenario(
  scenario: 'normal' | 'retry-once' | 'terminal-failure',
): Promise<void> {
  const descriptor = JSON.parse(await readFile(
    path.resolve(process.cwd(), 'artifacts/golden-journey/environment.json'),
    'utf8',
  )) as GoldenEnvironmentDescriptor
  const response = await fetch(`${descriptor.providerBaseUrl}/__golden/media-control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario }),
  })
  if (!response.ok) throw new Error(`GOLDEN_MEDIA_CONTROL_HTTP_${String(response.status)}`)
}
