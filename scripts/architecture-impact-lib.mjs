import path from 'node:path'

export function normalizeRepoPath(value, root) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!path.isAbsolute(normalized)) return normalized
  return path.relative(root, normalized).replaceAll('\\', '/')
}

export function uniquePaths(values) {
  return [...new Set(values)]
}

export function parseGitStatusPorcelainZ(raw, root) {
  const records = raw.split('\0')
  const changedPaths = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error(`ARCHITECTURE_IMPACT_GIT_STATUS_INVALID:${record}`)
    }

    const status = record.slice(0, 2)
    changedPaths.push(record.slice(3))

    if (status.includes('R') || status.includes('C')) {
      const previousPath = records[index + 1]
      if (!previousPath) {
        throw new Error(`ARCHITECTURE_IMPACT_GIT_RENAME_INVALID:${record}`)
      }
      changedPaths.push(previousPath)
      index += 1
    }
  }

  return uniquePaths(changedPaths.map((value) => normalizeRepoPath(value, root)).filter(Boolean))
}

export function matchingArchitecturePaths(requestedPath, architectureModule, root) {
  return [architectureModule.document, ...architectureModule.sourcePaths]
    .map((value) => normalizeRepoPath(value, root))
    .filter((sourcePath) => (
      requestedPath === sourcePath
      || requestedPath.startsWith(`${sourcePath}/`)
      || sourcePath.startsWith(`${requestedPath}/`)
    ))
}

export function findArchitectureMatches(requestedPath, modules, root) {
  return modules
    .map((architectureModule) => ({
      architectureModule,
      sourcePaths: matchingArchitecturePaths(requestedPath, architectureModule, root),
    }))
    .filter((match) => match.sourcePaths.length > 0)
}
