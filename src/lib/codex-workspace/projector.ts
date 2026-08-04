import { prisma } from '@/lib/prisma'
import {
  CREATIVE_SKILLS,
  readCreativeSkillResource,
} from '@/lib/creative-skills'
import {
  validateWorkspaceBundle,
  WORKSPACE_BUNDLE_SCHEMA_VERSION,
  type WorkspaceBundleFile,
} from '@/lib/codex-runtime/workspace-bundle'
import { encodeEditableResourceFile, encodeMediaPointer } from '@/lib/workspace-resource/file-format'
import { listAllWorkspaceResourcesForRuntime } from '@/lib/workspace-resource/view-service'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'
import {
  CODEX_WORKSPACE_PROJECT_FILE,
  CODEX_WORKSPACE_SKILL_ROOT,
  CodexWorkspaceError,
  type CodexWorkspaceBaselineResource,
  type CodexWorkspaceProjectSnapshot,
  type CodexWorkspaceProjection,
} from './contracts'

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function resourceFile(resource: WorkspaceResourceView): WorkspaceBundleFile {
  if (resource.resourceKind !== 'file' || !resource.mediaType) {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID',
      `Only file Resources can be projected as files: ${resource.resourceId}`,
    )
  }
  if (resource.mediaType !== 'text') {
    return { path: resource.workspacePath, content: encodeMediaPointer(resource) }
  }
  let content = ''
  const currentContent = resource.current?.content ?? null
  if (currentContent?.kind === 'text') content = currentContent.text
  if (currentContent?.kind === 'structured') content = formatJson(currentContent.data)
  if (currentContent?.kind === 'media') {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID',
      `Text Resource has media content: ${resource.resourceId}`,
    )
  }
  return {
    path: resource.workspacePath,
    content: encodeEditableResourceFile({
      resourceId: resource.resourceId,
      workspacePath: resource.workspacePath,
      content,
    }),
  }
}

function explicitDirectories(input: {
  readonly folderPaths: readonly string[]
  readonly filePaths: readonly string[]
}): string[] {
  const directories = new Set<string>(input.folderPaths)
  for (const filePath of input.filePaths) {
    const segments = filePath.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'))
    }
  }
  return [...directories].sort((left, right) => left.localeCompare(right))
}

async function readCreativeSkillFiles(): Promise<WorkspaceBundleFile[]> {
  return await Promise.all(CREATIVE_SKILLS.map(async (definition) => {
    const resource = await readCreativeSkillResource({ uri: definition.entryUri })
    return {
      path: `${CODEX_WORKSPACE_SKILL_ROOT}/${definition.id}/SKILL.md`,
      content: resource.content,
    }
  }))
}

export async function readCodexRuntimeWorkspace(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<CodexWorkspaceProjection> {
  const [project, resources, skillFiles] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
        name: true,
        description: true,
        videoRatio: true,
        videoResolution: true,
        imageResolution: true,
      },
    }),
    listAllWorkspaceResourcesForRuntime(input),
    readCreativeSkillFiles(),
  ])
  if (!project) throw new Error('CODEX_WORKSPACE_PROJECT_NOT_OWNED')
  const snapshot: CodexWorkspaceProjectSnapshot = {
    schemaVersion: 1,
    projectId: project.id,
    name: project.name,
    description: project.description,
    videoRatio: project.videoRatio,
    videoResolution: project.videoResolution,
    imageResolution: project.imageResolution,
    instructions: [
      'Project files outside system/ are the creative workspace and may be organized freely.',
      'system/ is read-only projected context. Never create, edit, move, or delete files there.',
      'Media .resource files are system-owned pointers. Move or delete them; never edit their contents.',
      'Use Wao MCP capabilities for paid media creation and always provide an outputPath.',
    ],
  }
  const fileResources = resources.filter((resource) => resource.resourceKind === 'file')
  const folderResources = resources.filter((resource) => resource.resourceKind === 'folder')
  const resourceFiles = fileResources.map(resourceFile)
  const projectedFiles = [
    ...resourceFiles,
    { path: CODEX_WORKSPACE_PROJECT_FILE, content: formatJson(snapshot) },
    ...skillFiles,
  ]
  const runtimeBundle = validateWorkspaceBundle({
    schemaVersion: WORKSPACE_BUNDLE_SCHEMA_VERSION,
    directories: explicitDirectories({
      folderPaths: folderResources.map((resource) => resource.workspacePath),
      filePaths: projectedFiles.map((file) => file.path),
    }),
    files: projectedFiles,
  })
  const fileContentById = new Map(fileResources.map((resource, index) => [
    resource.resourceId,
    resourceFiles[index]?.content ?? '',
  ]))
  const baselineResources: CodexWorkspaceBaselineResource[] = resources.map((resource) => ({
    resourceId: resource.resourceId,
    workspacePath: resource.workspacePath,
    resourceKind: resource.resourceKind,
    mediaType: resource.mediaType,
    contentVersion: resource.contentVersion,
    fileContent: fileContentById.get(resource.resourceId) ?? null,
    runtimeIdentity: null,
  }))
  return {
    runtimeBundle,
    baseline: { schemaVersion: 1, resources: baselineResources },
    skillEntryPaths: skillFiles.map((file) => file.path),
  }
}
