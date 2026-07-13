'use client'

import { useState, useEffect, useCallback } from 'react'

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
}

export function useWorkspaceAssetLibraryShell({
  searchParams,
  router,
}: UseWorkspaceAssetLibraryShellParams) {
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false)
  const [assetLibraryFocusCharacterId, setAssetLibraryFocusCharacterId] = useState<string | null>(null)
  const [assetLibraryFocusRequestId, setAssetLibraryFocusRequestId] = useState(0)

  const openAssetLibrary = useCallback((focusCharacterId?: string | null) => {
    setAssetLibraryFocusCharacterId(focusCharacterId || null)
    setAssetLibraryFocusRequestId(prev => prev + 1)
    setIsAssetLibraryOpen(true)
  }, [])

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

  return {
    isAssetLibraryOpen,
    assetLibraryFocusCharacterId,
    assetLibraryFocusRequestId,
    openAssetLibrary,
    closeAssetLibrary,
  }
}
