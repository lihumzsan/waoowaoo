import {
  workspaceResourceParentPath,
  type WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'

/**
 * Canvas node budget: the current folder projects its whole subtree; folders
 * stay expanded in place while the visible card count fits the budget, and a
 * collapsed folder contributes exactly one card. This is the explicit upper
 * bound of nodes a canvas may materialize.
 */
export const WORKSPACE_CANVAS_EXPANSION_BUDGET = 120

export interface WorkspaceCanvasFolderTreeNode {
  /** Null for the current canvas root (which is not itself projected). */
  readonly folder: WorkspaceResourceView | null
  readonly folders: readonly WorkspaceCanvasFolderTreeNode[]
  readonly resources: readonly WorkspaceResourceView[]
}

interface MutableTreeNode {
  folder: WorkspaceResourceView | null
  folders: MutableTreeNode[]
  resources: WorkspaceResourceView[]
}

/**
 * Rebuilds the folder tree of the current canvas from the subtree listing.
 * Parent/child relations derive from the shared Catalog path relation only.
 * Rows whose parent folder is absent from the listing attach to the root so
 * a partial page stays visible instead of silently dropping resources.
 */
export function buildWorkspaceCanvasFolderTree(input: {
  readonly currentFolderPath: string | null
  readonly resources: readonly WorkspaceResourceView[]
}): WorkspaceCanvasFolderTreeNode {
  const root: MutableTreeNode = { folder: null, folders: [], resources: [] }
  const nodesByPath = new Map<string, MutableTreeNode>()
  for (const resource of input.resources) {
    if (resource.resourceKind !== 'folder') continue
    nodesByPath.set(resource.workspacePath, { folder: resource, folders: [], resources: [] })
  }
  const parentOf = (workspacePath: string): MutableTreeNode => {
    const parentPath = workspaceResourceParentPath(workspacePath)
    if (parentPath === input.currentFolderPath) return root
    return (parentPath !== null ? nodesByPath.get(parentPath) : undefined) ?? root
  }
  for (const resource of input.resources) {
    const parent = parentOf(resource.workspacePath)
    if (resource.resourceKind === 'folder') {
      const node = nodesByPath.get(resource.workspacePath)
      if (node) parent.folders.push(node)
      continue
    }
    parent.resources.push(resource)
  }
  return root
}

export function countWorkspaceFolderFiles(node: WorkspaceCanvasFolderTreeNode): number {
  return node.resources.length
    + node.folders.reduce((sum, child) => sum + countWorkspaceFolderFiles(child), 0)
}

function countVisible(
  node: WorkspaceCanvasFolderTreeNode,
  collapsed: ReadonlySet<string>,
): number {
  let total = node.resources.length
  for (const child of node.folders) {
    const childId = child.folder?.resourceId
    total += childId && collapsed.has(childId) ? 1 : countVisible(child, collapsed)
  }
  return total
}

function collectFolderIds(root: WorkspaceCanvasFolderTreeNode, into: Set<string>): void {
  for (const child of root.folders) {
    if (child.folder) into.add(child.folder.resourceId)
    collectFolderIds(child, into)
  }
}

/**
 * The single display rule: everything starts expanded; while the visible card
 * count exceeds the budget, the expanded folder with the most descendant files
 * collapses next. Deterministic — no timers, no viewport heuristics.
 *
 * `seed` carries the folders already collapsed in the current canvas session:
 * they stay collapsed (monotonic within one visit) so mid-session content
 * growth can only add collapses, never pop a folded folder back open. The
 * baseline resets when the canvas is entered again.
 */
export function computeCollapsedWorkspaceFolders(
  root: WorkspaceCanvasFolderTreeNode,
  budget: number,
  seed?: ReadonlySet<string>,
): ReadonlySet<string> {
  const collapsed = new Set<string>()
  if (seed && seed.size > 0) {
    const existing = new Set<string>()
    collectFolderIds(root, existing)
    for (const id of seed) {
      if (existing.has(id)) collapsed.add(id)
    }
  }
  for (;;) {
    if (countVisible(root, collapsed) <= budget) break
    const candidates: WorkspaceCanvasFolderTreeNode[] = []
    const walk = (node: WorkspaceCanvasFolderTreeNode) => {
      for (const child of node.folders) {
        const childId = child.folder?.resourceId
        if (!childId || collapsed.has(childId)) continue
        candidates.push(child)
        walk(child)
      }
    }
    walk(root)
    if (candidates.length === 0) break
    const pick = candidates.reduce((best, next) => (
      countWorkspaceFolderFiles(next) > countWorkspaceFolderFiles(best) ? next : best
    ))
    const pickId = pick.folder?.resourceId
    if (!pickId) break
    collapsed.add(pickId)
  }
  return collapsed
}
