'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceResources } from '@/lib/query/hooks'
import {
  isWorkspaceResourceSubtreePath,
  type WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  buildWorkspaceCanvasFolderTree,
  countWorkspaceFolderFiles,
  type WorkspaceCanvasFolderTreeNode,
} from '../projection/workspace-canvas-expansion-policy'

const PANEL_BUTTON_CLASS =
  'inline-flex h-9 items-center justify-center rounded-full border border-white/80 bg-white/88 text-[var(--glass-text-secondary)] shadow-lg ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl transition-colors hover:bg-white hover:text-[var(--glass-text-primary)]'

function DirectoryTreeRow({
  node,
  depth,
  folderDisplays,
  canvasSubtreePaths,
  countLabel,
  jumpTitle,
  enterTitle,
  fileLocateTitle,
  onRowActivate,
  onEnter,
  onFileActivate,
}: {
  readonly node: WorkspaceCanvasFolderTreeNode
  readonly depth: number
  readonly folderDisplays: ReadonlyMap<string, 'card' | 'section'>
  readonly canvasSubtreePaths: readonly string[]
  readonly countLabel: (count: number) => string
  readonly jumpTitle: string
  readonly enterTitle: string
  readonly fileLocateTitle: string
  readonly onRowActivate: (folder: WorkspaceResourceView) => void
  readonly onEnter: (folder: WorkspaceResourceView) => void
  readonly onFileActivate: (resource: WorkspaceResourceView) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const folderResource = node.folder
  const childFolders = node.folders.filter((child) => child.folder !== null)
  if (!folderResource) return null
  const fileCount = countWorkspaceFolderFiles(node)
  const hasChildren = childFolders.length > 0 || node.resources.length > 0
  // 空文件夹可以显示,但没有任何激活动作:不跳转、不进入,点击无效。
  const inert = fileCount === 0
  const display = folderDisplays.get(folderResource.resourceId) ?? null
  // 可跳转 = 该文件夹子树与当前画布顶层节点有交集(中间目录也算,跳到后代分组
  // 的并集范围);展开内容无需"进入",收起卡与画布外的文件夹才提供进入。
  const jumpable = !inert && canvasSubtreePaths.some(
    (path) => isWorkspaceResourceSubtreePath(path, folderResource.workspacePath),
  )
  const canEnter = !inert && (display === 'card' || !jumpable)
  return (
    <div>
      <div
        className={`group flex w-full items-center gap-1 rounded-lg py-1.5 pr-1.5 text-xs text-[var(--glass-text-secondary)] ${
          inert ? 'cursor-default opacity-55' : 'cursor-pointer hover:bg-[var(--glass-selection-hover-bg)]'
        }`}
        style={{ paddingLeft: 4 + depth * 14 }}
        title={inert ? undefined : jumpable ? jumpTitle : enterTitle}
        onClick={inert ? undefined : () => onRowActivate(folderResource)}
      >
        <button
          type="button"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-selection-hover-bg)] ${hasChildren ? '' : 'invisible'}`}
          onClick={(event) => {
            event.stopPropagation()
            setExpanded((value) => !value)
          }}
        >
          <AppIcon
            name="chevronRight"
            className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--glass-text-primary)]">
          {folderResource.name}
        </span>
        <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${inert ? 'bg-slate-100 text-[var(--glass-text-tertiary)]' : 'bg-[var(--glass-focus-ring)] text-[var(--glass-tone-info-fg)] group-hover:hidden'}`}>
          {countLabel(fileCount)}
        </span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {jumpable ? (
            <span className="rounded-md p-1 text-[var(--glass-tone-info-fg)]" title={jumpTitle}>
              <AppIcon name="crosshair" className="h-3.5 w-3.5" />
            </span>
          ) : null}
          {canEnter ? (
            <button
              type="button"
              className="rounded-md p-1 text-[var(--glass-tone-info-fg)] hover:bg-[var(--glass-selection-hover-bg)]"
              title={enterTitle}
              onClick={(event) => {
                event.stopPropagation()
                onEnter(folderResource)
              }}
            >
              <AppIcon name="arrowRight" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </span>
      </div>
      {expanded
        ? (
            <>
              {childFolders.map((child) => (
                <DirectoryTreeRow
                  key={child.folder?.resourceId}
                  node={child}
                  depth={depth + 1}
                  folderDisplays={folderDisplays}
                  canvasSubtreePaths={canvasSubtreePaths}
                  countLabel={countLabel}
                  jumpTitle={jumpTitle}
                  enterTitle={enterTitle}
                  fileLocateTitle={fileLocateTitle}
                  onRowActivate={onRowActivate}
                  onEnter={onEnter}
                  onFileActivate={onFileActivate}
                />
              ))}
              {node.resources.map((resource) => (
                <DirectoryFileRow
                  key={resource.resourceId}
                  resource={resource}
                  depth={depth + 1}
                  locateTitle={fileLocateTitle}
                  onActivate={onFileActivate}
                />
              ))}
            </>
          )
        : null}
    </div>
  )
}

function resourceIconName(resource: WorkspaceResourceView): 'audioWave' | 'fileText' | 'image' | 'video' {
  if (resource.mediaType === 'image') return 'image'
  if (resource.mediaType === 'audio') return 'audioWave'
  if (resource.mediaType === 'video') return 'video'
  return 'fileText'
}

function DirectoryFileRow({
  resource,
  depth,
  locateTitle,
  onActivate,
}: {
  readonly resource: WorkspaceResourceView
  readonly depth: number
  readonly locateTitle: string
  readonly onActivate: (resource: WorkspaceResourceView) => void
}) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-1 rounded-lg py-1.5 pr-1.5 text-left text-xs text-[var(--glass-text-secondary)] hover:bg-[var(--glass-selection-hover-bg)]"
      style={{ paddingLeft: 4 + depth * 14 }}
      title={locateTitle}
      onClick={() => onActivate(resource)}
    >
      <span className="h-4 w-4 shrink-0" aria-hidden="true" />
      <AppIcon
        name={resourceIconName(resource)}
        className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]"
      />
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--glass-text-primary)]">
        {resource.name}
      </span>
      <AppIcon
        name="crosshair"
        className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)] opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>
  )
}

/**
 * Collapsed-by-default canvas navigation. The expanded panel holds the project
 * directory tree (folders plus their direct files) plus the cross-project
 * search. Folder rows jump to the matching canvas group when it is projected;
 * file rows and search results share the canonical Resource navigation entry,
 * which locates the exact file node by resourceId.
 */
export function CanvasFolderNavigation(props: {
  readonly canGoBack: boolean
  readonly folderDisplays: ReadonlyMap<string, 'card' | 'section'>
  readonly canvasSubtreePaths: readonly string[]
  readonly onJumpToFolder: (folder: WorkspaceResourceView) => boolean
  readonly search: string
  readonly searchPlaceholder: string
  readonly backLabel: string
  readonly searchResultsLabel: string
  readonly noResultsLabel: string
  readonly loadingLabel: string
  readonly loadFailedLabel: string
  readonly retryLabel: string
  readonly loadMoreLabel: string
  readonly searchResults: readonly WorkspaceResourceView[]
  readonly searchLoading: boolean
  readonly searchFailed: boolean
  readonly searchHasMore: boolean
  readonly onBack: () => void
  readonly onSearchChange: (value: string) => void
  readonly onSearchResult: (resource: WorkspaceResourceView) => void
  readonly onRetrySearch: () => void
  readonly onLoadMoreSearch: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.folderNavigation')
  const { projectId } = useWorkspaceProvider()
  const [open, setOpen] = useState(false)
  const hasSearch = props.search.trim().length > 0

  const treeQuery = useWorkspaceResources({
    projectId,
    prefix: null,
    search: null,
    scope: 'subtree',
    enabled: open,
  })
  const fetchNextTreePage = treeQuery.fetchNextPage
  const treeHasNextPage = treeQuery.hasNextPage
  const treeFetchingNextPage = treeQuery.isFetchingNextPage
  useEffect(() => {
    if (!open || !treeHasNextPage || treeFetchingNextPage) return
    void fetchNextTreePage()
  }, [fetchNextTreePage, open, treeFetchingNextPage, treeHasNextPage])
  const treeResources = useMemo(() => {
    const byId = new Map<string, WorkspaceResourceView>()
    for (const page of treeQuery.data?.pages ?? []) {
      for (const resource of page.items) byId.set(resource.resourceId, resource)
    }
    return [...byId.values()]
  }, [treeQuery.data])
  const tree = useMemo(
    () => buildWorkspaceCanvasFolderTree({ currentFolderPath: null, resources: treeResources }),
    [treeResources],
  )
  const rootFolders = tree.folders.filter((child) => child.folder !== null)
  const rootFiles = tree.resources
  const treeReady = !treeQuery.isLoading && !treeQuery.isError && !treeHasNextPage
  // 搜索结果里的空文件夹同样只展示不激活——系统不存在进入空文件夹的入口。
  const folderFileCounts = useMemo(() => {
    const counts = new Map<string, number>()
    const walk = (candidate: WorkspaceCanvasFolderTreeNode) => {
      for (const child of candidate.folders) {
        if (!child.folder) continue
        counts.set(child.folder.resourceId, countWorkspaceFolderFiles(child))
        walk(child)
      }
    }
    walk(tree)
    return counts
  }, [tree])
  const searchResultInert = (resource: WorkspaceResourceView): boolean =>
    resource.resourceKind === 'folder' && (folderFileCounts.get(resource.resourceId) ?? 0) === 0

  const enterFolder = (resource: WorkspaceResourceView) => {
    setOpen(false)
    props.onSearchResult(resource)
  }
  const activateRow = (resource: WorkspaceResourceView) => {
    // 跳转优先:面板保持打开,方便连续跳转;跳不了(子树不在当前画布)才进入。
    if (props.onJumpToFolder(resource)) return
    enterFolder(resource)
  }

  return (
    <div
      className="flex flex-col items-start gap-1.5"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
      }}
    >
      <div className="flex items-center gap-1.5">
        {props.canGoBack ? (
          <button
            type="button"
            aria-label={props.backLabel}
            title={props.backLabel}
            className={`${PANEL_BUTTON_CLASS} w-9`}
            onClick={props.onBack}
          >
            <AppIcon name="chevronLeft" className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {/* "目录"胶囊本身就是开关:再点一次收回,无需找关闭按钮。 */}
        <button
          type="button"
          aria-expanded={open}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-white/80 px-3.5 text-[12px] font-medium shadow-lg ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl transition-colors ${
            open
              ? 'bg-white text-[var(--glass-text-primary)]'
              : 'bg-white/88 text-[var(--glass-text-secondary)] hover:bg-white hover:text-[var(--glass-text-primary)]'
          }`}
          onClick={() => setOpen((value) => !value)}
        >
          <AppIcon name="folder" className="h-3.5 w-3.5 text-[var(--glass-tone-info-fg)]" />
          {t('directory')}
        </button>
      </div>
      {open ? (
        <div className="nodrag nopan nowheel w-[min(22rem,calc(100vw-8rem))] rounded-2xl border border-white/80 bg-white/88 p-2 shadow-lg ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl">
      <label className="relative block">
        <AppIcon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--glass-text-tertiary)]" />
        <input
          value={props.search}
          placeholder={props.searchPlaceholder}
          className="glass-input-base w-full py-2 pl-8 pr-8 text-xs"
          onChange={(event) => props.onSearchChange(event.target.value)}
        />
        {hasSearch ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--glass-text-tertiary)] hover:bg-slate-100"
            onClick={() => props.onSearchChange('')}
          >
            <AppIcon name="close" className="h-3 w-3" />
          </button>
        ) : null}
      </label>
      {hasSearch ? (
        <div className="mt-1.5 overflow-hidden">
          <p className="border-b border-[var(--glass-stroke-soft)] px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">
            {props.searchResultsLabel}
          </p>
          {props.searchFailed ? (
            <div className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-[var(--glass-tone-danger-fg)]">
              <span>{props.loadFailedLabel}</span>
              <button type="button" className="font-semibold" onClick={props.onRetrySearch}>
                {props.retryLabel}
              </button>
            </div>
          ) : props.searchLoading && props.searchResults.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--glass-text-tertiary)]">{props.loadingLabel}</p>
          ) : props.searchResults.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--glass-text-tertiary)]">{props.noResultsLabel}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto p-1.5">
              {props.searchResults.map((resource) => (
                <li key={resource.resourceId}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
                      searchResultInert(resource) ? 'cursor-default opacity-55' : 'hover:bg-[var(--glass-selection-hover-bg)]'
                    }`}
                    onClick={searchResultInert(resource) ? undefined : () => enterFolder(resource)}
                  >
                    <AppIcon
                      name={resource.resourceKind === 'folder' ? 'folder' : resourceIconName(resource)}
                      className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-[var(--glass-text-primary)]">
                        {resource.name}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--glass-text-tertiary)]">
                        {resource.workspacePath}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {props.searchHasMore ? (
                <li>
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-xs font-semibold text-[var(--glass-tone-info-fg)] hover:bg-slate-50"
                    onClick={props.onLoadMoreSearch}
                  >
                    {props.loadMoreLabel}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-1.5 max-h-72 overflow-y-auto p-0.5">
          {treeQuery.isError ? (
            <div className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-[var(--glass-tone-danger-fg)]">
              <span>{props.loadFailedLabel}</span>
              <button type="button" className="font-semibold" onClick={() => { void treeQuery.refetch() }}>
                {props.retryLabel}
              </button>
            </div>
          ) : !treeReady ? (
            <p className="px-2 py-2 text-xs text-[var(--glass-text-tertiary)]">{props.loadingLabel}</p>
          ) : rootFolders.length === 0 && rootFiles.length === 0 ? (
            <p className="px-2 py-2 text-xs text-[var(--glass-text-tertiary)]">{t('directoryEmpty')}</p>
          ) : (
            <>
              {rootFolders.map((child) => (
                <DirectoryTreeRow
                  key={child.folder?.resourceId}
                  node={child}
                  depth={0}
                  folderDisplays={props.folderDisplays}
                  canvasSubtreePaths={props.canvasSubtreePaths}
                  countLabel={(count) => t('sectionCount', { count })}
                  jumpTitle={t('jumpToFolder')}
                  enterTitle={t('openFolder')}
                  fileLocateTitle={t('locateFile')}
                  onRowActivate={activateRow}
                  onEnter={enterFolder}
                  onFileActivate={enterFolder}
                />
              ))}
              {rootFiles.map((resource) => (
                <DirectoryFileRow
                  key={resource.resourceId}
                  resource={resource}
                  depth={0}
                  locateTitle={t('locateFile')}
                  onActivate={enterFolder}
                />
              ))}
            </>
          )}
        </div>
      )}
        </div>
      ) : null}
    </div>
  )
}
