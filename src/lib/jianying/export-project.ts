import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '@/lib/errors/app-error'
import type { Locale } from '@/i18n/routing'
import { jianyingPackageReadme } from './package-copy'
import JSZip from 'jszip'
import type { JianyingProfile } from './profile'
import type {
  VideoComposition,
  CompositionFormat,
} from '@/lib/video-compose/composition-contract'
import { resolveCompositionTiming } from '@/lib/video-compose/composition-timing'
import type { CompositionSourceFacts } from '@/lib/video-compose/composition-contract'

const execFileAsync = promisify(execFile)
const zipDate = new Date('1980-01-01T00:00:00.000Z')

export async function exportJianyingProject(input: {
  identity: string
  name: string
  locale: Locale
  format: CompositionFormat
  composition: VideoComposition
  profile: JianyingProfile
  sourceFacts: readonly CompositionSourceFacts[]
  sourcePaths: readonly string[]
  workspaceDir: string
}): Promise<Buffer> {
  const python = process.env.JIANYING_PYTHON_PATH?.trim()
  if (!python || !path.isAbsolute(python))
    throw new AppError('JIANYING_CONFIGURATION_REQUIRED')
  const output = path.join(input.workspaceDir, 'project')
  await mkdir(output)
  const mediaFiles = new Map<string, { bytes: Buffer; fileName: string }>()
  const media = []
  for (const [index, file] of input.sourcePaths.entries()) {
    const facts = input.sourceFacts[index]
    if (!facts) throw new Error('COMPOSITION_SOURCE_FACTS_MISSING')
    let source = mediaFiles.get(file)
    if (!source) {
      const bytes = await readFile(file)
      source = {
        bytes,
        fileName: `${createHash('sha256').update(bytes).digest('hex')}.mp4`,
      }
      mediaFiles.set(file, source)
    }
    media.push({ fileName: source.fileName, ...facts })
  }
  const requestFile = path.join(input.workspaceDir, 'export-request.json')
  await writeFile(
    requestFile,
    JSON.stringify({
      identity: input.identity,
      name: input.name,
      profile: input.profile,
      timeline: resolveCompositionTiming(input.composition,input.format.frameRate),
      audioMode: input.composition.audio.mode,
      sources: media,
      format: input.format,
    }),
  )
  try {
    await execFileAsync(
      python,
      [
        path.join(process.cwd(), 'scripts/jianying/export_project.py'),
        requestFile,
        output,
      ],
      {
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      },
    )
  } catch (error) {
    throw new AppError('JIANYING_EXPORT_FAILED', undefined, { cause: error })
  }
  const files = new Map<string, Buffer>()
  for (const item of mediaFiles.values())
    files.set(`media/${item.fileName}`, item.bytes)
  for (const file of [input.profile.draftFileName, 'draft_meta_info.json'])
    files.set(file, await readFile(path.join(output, file)))
  const manifest = {
    schemaVersion: 1,
    draftFileName: input.profile.draftFileName,
    profileRevision: input.profile.revision,
    templateHash: input.profile.templateHash,
    files: [...files.entries()].map(([file, bytes]) => ({
      path: file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
  }
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
  files.set(
    'composition.json',
    Buffer.from(JSON.stringify(input.composition, null, 2)),
  )
  files.set(
    'import_project.py',
    await readFile(
      path.join(process.cwd(), 'scripts/jianying/import_project.py'),
    ),
  )
  files.set('README.txt', Buffer.from(jianyingPackageReadme(input.locale)))
  const zip = new JSZip()
  for (const [file, bytes] of files)
    zip.file(file, bytes, { date: zipDate, createFolders: false })
  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
  })
}
