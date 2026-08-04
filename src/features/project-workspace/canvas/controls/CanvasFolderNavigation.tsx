'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceResources } from '@/lib/query/hooks'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  buildWorkspaceCanvasFolderTree,
  countWorkspaceFolderFiles,
  type WorkspaceCanvasFolderTreeNode,
} from '../projection/workspace-canvas-expansion-policy'

const PANEL_BUTTON_CLASS =
  'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/80 bg-white/88 text-[var(--glass-text-secondary)] shadow-lg ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl transition-colors hover:bg-white hover:text-[var(--glass-text-primary)]'

function DirectoryTreeRow({
  node,
  depth,
  countLabel,
  onSelect,
}: {
  readonly node: WorkspaceCanvasFolderTreeNode
  readonly depth: number
  readonly countLabel: (count: number) => string
  readonly onSelect: (folder: WorkspaceResourceView) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const folderResource = node.folder
  const childFolders = node.folders.filter((child) => child.folder !== null)
  if (!folderResource) return null
  return (
    <div>
      <div
        className="group flex w-full cursor-pointer items-center gap-1 rounded-lg py-1 pr-2 text-xs text-[var(--glass-text-secondary)] hover:bg-slate-100"
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => onSelect(folderResource)}
      >
        <button
          type="button"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--glass-text-tertiary)] hover:bg-slate-200 ${childFolders.length > 0 ? '' : 'invisible'}`}
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
        <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--glass-text-primary)]">
          {folderResource.name}
        </span>
        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] text-[var(--glass-text-tertiary)] group-hover:bg-slate-200">
          {countLabel(countWorkspaceFolderFiles(node))}
        </span>
      </div>
      {expanded
        ? childFolders.map((child) => (
            <DirectoryTreeRow
              key={child.folder?.resourceId}
              node={child}
              depth={depth + 1}
              countLabel={countLabel}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  )
}

/**
 * Collapsed-by-default canvas navigation: a compact back button plus a
 * directory toggle. The expanded panel holds the project directory tree
 * (subtree listing, folders only) and the cross-project search; selecting
 * either navigates through the same resource callback.
 */
export function CanvasFolderNavigation(props: {
  readonly canGoBack: boolean
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
  const treeReady = !treeQuery.isLoading && !treeQuery.isError && !treeHasNextPage

  const selectResource = (resource: WorkspaceResourceView) => {
    setOpen(false)
    props.onSearchResult(resource)
  }

  if (!open) {
    return (
      <div className="flex items-center gap-1.5">
        {props.canGoBack ? (
          <button
            type="button"
            aria-label={props.backLabel}
            title={props.backLabel}
            className={PANEL_BUTTON_CLASS}
            onClick={props.onBack}
          >
            <AppIcon name="chevronLeft" className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={t('directory')}
          title={t('directory')}
          className={PANEL_BUTTON_CLASS}
          onClick={() => setOpen(true)}
        >
          <AppIcon name="folder" className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="nodrag nopan nowheel w-[min(22rem,calc(100vw-8rem))] rounded-2xl border border-white/80 bg-white/88 p-2 shadow-lg ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        setOpen(false)
      }}
    >
      <div className="flex items-center gap-1.5 pb-1.5">
        {props.canGoBack ? (
          <button
            type="button"
            aria-label={props.backLabel}
            title={props.backLabel}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--glass-text-secondary)] hover:bg-slate-100 hover:text-[var(--glass-text-primary)]"
            onClick={props.onBack}
          >
            <AppIcon name="chevronLeft" className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">
          {t('directory')}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t('directory')}
          className="rounded-full p-1 text-[var(--glass-text-tertiary)] hover:bg-slate-100"
          onClick={() => setOpen(false)}
        >
          <AppIcon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
      <label className="relative block">
        <AppIcon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--glass-text-tertiary)]" />
        <input
          value={props.search}
          placeholder={props.searchPlaceholder}
          className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white py-2 pl-8 pr-8 text-xs text-[var(--glass-text-primary)] outline-none focus:border-slate-400"
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
        <div className="mt-2 overflow-hidden rounded-xl border border-[var(--glass-stroke-soft)] bg-white">
          <p className="border-b border-[var(--glass-stroke-soft)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">
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
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
                    onClick={() => selectResource(resource)}
                  >
                    <AppIcon
                      name={resource.resourceKind === 'folder' ? 'folder' : 'fileText'}
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
        <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-[var(--glass-stroke-soft)] bg-white p-1.5">
          {treeQuery.isError ? (
            <div className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-[var(--glass-tone-danger-fg)]">
              <span>{props.loadFailedLabel}</span>
              <button type="button" className="font-semibold" onClick={() => { void treeQuery.refetch() }}>
                {props.retryLabel}
              </button>
            </div>
          ) : !treeReady ? (
            <p className="px-2 py-2 text-xs text-[var(--glass-text-tertiary)]">{props.loadingLabel}</p>
          ) : rootFolders.length === 0 ? (
            <p className="px-2 py-2 text-xs text-[var(--glass-text-tertiary)]">{t('directoryEmpty')}</p>
          ) : (
            rootFolders.map((child) => (
              <DirectoryTreeRow
                key={child.folder?.resourceId}
                node={child}
                depth={0}
                countLabel={(count) => t('sectionCount', { count })}
                onSelect={selectResource}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
