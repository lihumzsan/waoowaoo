'use client'

import { useState, useEffect, useCallback } from 'react'

type RefreshOptions = { scope?: string; mode?: string }

interface RouterLike {
  replace: (href: string, options?: { scroll?: boolean }) => void
}

interface SearchParamsLike {
  get: (name: string) => string | null
  toString: () => string
}

interface UseWorkspaceAssetLibraryShellParams {
  searchParams: SearchParamsLike | null
  router: RouterLike
  onRefresh: (options?: RefreshOptions) => Promise<void>
}

export function useWorkspaceAssetLibraryShell({
  searchParams,
  router,
  onRefresh,
}: UseWorkspaceAssetLibraryShellParams) {
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false)
  const [assetLibraryFocusCharacterId, setAssetLibraryFocusCharacterId] = useState<string | null>(null)
  const [assetLibraryFocusRequestId, setAssetLibraryFocusRequestId] = useState(0)

  const openAssetLibrary = useCallback((focusCharacterId?: string | null, refreshAssets = true) => {
    setAssetLibraryFocusCharacterId(focusCharacterId || null)
    setAssetLibraryFocusRequestId(prev => prev + 1)
    setIsAssetLibraryOpen(true)

    if (refreshAssets) {
      window.setTimeout(() => {
        onRefresh({ scope: 'assets' })
      }, 0)
    }
  }, [onRefresh])

  const closeAssetLibrary = useCallback(() => {
    setIsAssetLibraryOpen(false)
    setAssetLibraryFocusCharacterId(null)
  }, [])

  useEffect(() => {
    if (!searchParams) return

    const shouldOpenAssetLibrary = searchParams.get('assetLibrary') === '1'
    const focusCharacterId = searchParams.get('focusCharacter')

    if (!shouldOpenAssetLibrary) {
      return
    }

    const newParams = new URLSearchParams(searchParams.toString())
    if (shouldOpenAssetLibrary) newParams.delete('assetLibrary')
    router.replace(`?${newParams.toString()}`, { scroll: false })

    openAssetLibrary(focusCharacterId)
  }, [openAssetLibrary, router, searchParams])

  useEffect(() => {
    void onRefresh({ scope: 'assets' })
  }, [onRefresh])

  return {
    isAssetLibraryOpen,
    assetLibraryFocusCharacterId,
    assetLibraryFocusRequestId,
    openAssetLibrary,
    closeAssetLibrary,
  }
}
