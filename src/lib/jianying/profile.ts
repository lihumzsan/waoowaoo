import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { AppError } from '@/lib/errors/app-error'

const execFileAsync = promisify(execFile)
const environmentSchema = z
  .object({
    pythonVersion: z.tuple([
      z.literal(3),
      z.number().int().min(10),
      z.number().int().nonnegative(),
    ]),
    sourceManifestHash: z.string().length(64),
  })
  .strict()
const jsonObject = z.record(z.string(), z.json())
export const jianyingProfileSchema = z
  .object({
    revision: z.literal('pyjianyingdraft-32c56928-wao-1'),
    draftFileName: z.enum(['draft_content.json', 'draft_info.json']),
    templateHash: z.string().length(64),
    draft: jsonObject,
    metadata: jsonObject,
    environment: environmentSchema,
  })
  .strict()
export type JianyingProfile = z.infer<typeof jianyingProfileSchema>

export function isJianyingConfigured(): boolean {
  return Boolean(
    process.env.JIANYING_PYTHON_PATH?.trim() &&
      path.isAbsolute(process.env.JIANYING_PYTHON_PATH.trim()) &&
      process.env.JIANYING_TEMPLATE_FILE?.trim(),
  )
}

async function probeJianyingExportEnvironment() {
  const python = process.env.JIANYING_PYTHON_PATH?.trim()
  if (!python || !path.isAbsolute(python))
    throw new AppError('JIANYING_CONFIGURATION_REQUIRED')
  try {
    const { stdout } = await execFileAsync(
      python,
      [path.join(process.cwd(), 'scripts/jianying/probe_environment.py')],
      {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      },
    )
    return environmentSchema.parse(JSON.parse(stdout) as unknown)
  } catch (error) {
    throw new AppError('JIANYING_CONFIGURATION_REQUIRED', undefined, {
      cause: error,
      details: { reasonCode: 'SERIALIZER_ENVIRONMENT_INVALID' },
    })
  }
}

export async function freezeJianyingProfile(): Promise<JianyingProfile> {
  const templateFile = process.env.JIANYING_TEMPLATE_FILE?.trim()
  if (
    !isJianyingConfigured() ||
    !templateFile ||
    !path.isAbsolute(templateFile)
  ) {
    throw new AppError('JIANYING_CONFIGURATION_REQUIRED')
  }
  const environment = await probeJianyingExportEnvironment()
  try {
    const fileName = z
      .enum(['draft_content.json', 'draft_info.json'])
      .parse(path.basename(templateFile))
    const [draftBytes, metadataBytes] = await Promise.all([
      readFile(templateFile),
      readFile(path.join(path.dirname(templateFile), 'draft_meta_info.json')),
    ])
    if (draftBytes.length + metadataBytes.length > 1024 * 1024)
      throw new AppError('JIANYING_TEMPLATE_INVALID')
    const draft = jsonObject.parse(
      JSON.parse(draftBytes.toString('utf8')) as unknown,
    )
    const metadata = jsonObject.parse(
      JSON.parse(metadataBytes.toString('utf8')) as unknown,
    )
    const emptyTemplate = z.object({
      tracks: z.array(z.unknown()).length(0),
      materials: z.record(z.string(), z.array(z.unknown()).length(0)),
      fps: z.number().int().min(1).max(120),
      duration: z.literal(0),
      canvas_config: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
      config: z.object({ maintrack_adsorb: z.boolean() }),
    })
    if (!emptyTemplate.safeParse(draft).success)
      throw new AppError('JIANYING_TEMPLATE_INVALID')
    return jianyingProfileSchema.parse({
      revision: 'pyjianyingdraft-32c56928-wao-1',
      environment,
      draftFileName: fileName,
      templateHash: createHash('sha256')
        .update(draftBytes)
        .update(metadataBytes)
        .digest('hex'),
      draft,
      metadata,
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('JIANYING_TEMPLATE_INVALID', undefined, { cause: error })
  }
}
