import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getCreativeSkillDefinition } from './registry'
import { parseCreativeSkillUri } from './uri'
import type { CreativeSkillResource, ReadCreativeSkillResourceInput } from './types'

const SKILL_ROOT_SEGMENTS = ['src', 'lib', 'creative-skills', 'skills'] as const
const SKILL_RESOURCE_FILE = 'SKILL.md'

function checksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export async function readCreativeSkillResource(
  input: ReadCreativeSkillResourceInput,
): Promise<CreativeSkillResource> {
  const parsed = parseCreativeSkillUri(input.uri)
  const definition = getCreativeSkillDefinition(parsed.skillId)
  if (definition.entryUri !== parsed.uri) {
    throw new Error(`CREATIVE_SKILL_RESOURCE_NOT_FOUND:${input.uri}`)
  }

  const root = path.resolve(process.cwd(), ...SKILL_ROOT_SEGMENTS)
  const filePath = path.resolve(root, definition.id, SKILL_RESOURCE_FILE)
  const expectedParent = path.resolve(root, definition.id)
  if (path.dirname(filePath) !== expectedParent) {
    throw new Error(`CREATIVE_SKILL_URI_INVALID:${input.uri}`)
  }

  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    const code = error instanceof Error && 'code' in error
      ? String((error as Error & { readonly code?: unknown }).code)
      : 'UNKNOWN'
    throw new Error(
      `CREATIVE_SKILL_RESOURCE_NOT_FOUND:${definition.id}:${code}`,
      { cause: error },
    )
  }

  return {
    skillId: definition.id,
    version: definition.version,
    uri: parsed.uri,
    checksum: checksum(content),
    content,
  }
}
