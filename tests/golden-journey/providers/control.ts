import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveGoldenArtifactRoot } from '../runtime/identity'

interface GoldenEnvironmentDescriptor {
  readonly providerBaseUrl: string
}

async function readGoldenEnvironmentDescriptor(): Promise<GoldenEnvironmentDescriptor> {
  return JSON.parse(await readFile(
    path.join(resolveGoldenArtifactRoot(), 'environment.json'),
    'utf8',
  )) as GoldenEnvironmentDescriptor
}

export async function setGoldenStreamPacing(
  streamPacing: { readonly chunkSize: number; readonly delayMs: number } | null,
): Promise<void> {
  const descriptor = await readGoldenEnvironmentDescriptor()
  const response = await fetch(`${descriptor.providerBaseUrl}/__golden/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ streamPacing }),
  })
  if (!response.ok) throw new Error(`GOLDEN_PROVIDER_CONTROL_HTTP_${String(response.status)}`)
}

export async function setGoldenMediaStatusDelay(delayMs: number): Promise<void> {
  const descriptor = await readGoldenEnvironmentDescriptor()
  const response = await fetch(`${descriptor.providerBaseUrl}/__golden/media-delay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delayMs }),
  })
  if (!response.ok) throw new Error(`GOLDEN_MEDIA_DELAY_HTTP_${String(response.status)}`)
}
