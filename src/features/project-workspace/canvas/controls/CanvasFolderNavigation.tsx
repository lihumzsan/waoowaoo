'use client'

import { AppIcon } from '@/components/ui/icons'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'

export interface CanvasFolderBreadcrumb {
  readonly folderKey: string
  readonly name: string
  readonly workspacePath: string
}

export function CanvasFolderNavigation(props: {
  readonly breadcrumbs: readonly CanvasFolderBreadcrumb[]
  readonly search: string
  readonly searchPlaceholder: string
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
  readonly onBreadcrumb: (breadcrumb: CanvasFolderBreadcrumb) => void
  readonly onSearchChange: (value: string) => void
  readonly onSearchResult: (resource: WorkspaceResourceView) => void
  readonly onRetrySearch: () => void
  readonly onLoadMoreSearch: () => void
}) {
  const hasSearch = props.search.trim().length > 0
  return (
    <div className="nodrag nowheel w-[min(34rem,calc(100vw-8rem))] rounded-2xl border border-white/80 bg-white/88 p-2.5 shadow-lg ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-2">
        {props.breadcrumbs.map((breadcrumb, index) => (
          <span key={breadcrumb.folderKey} className="flex shrink-0 items-center gap-1">
            {index > 0 ? (
              <AppIcon name="chevronRight" className="h-3 w-3 text-[var(--glass-text-tertiary)]" />
            ) : null}
            <button
              type="button"
              className="max-w-40 truncate rounded-lg px-2 py-1 text-xs font-medium text-[var(--glass-text-secondary)] hover:bg-slate-100 hover:text-[var(--glass-text-primary)]"
              title={breadcrumb.workspacePath || breadcrumb.name}
              onClick={() => props.onBreadcrumb(breadcrumb)}
            >
              {breadcrumb.name}
            </button>
          </span>
        ))}
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
                    onClick={() => props.onSearchResult(resource)}
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
      ) : null}
    </div>
  )
}
