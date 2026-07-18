'use client'

import { useCallback, useRef, useState } from 'react'

interface UseVideoPanelViewportParams {
  revealPanel: (panelKey: string) => void
}

export function useVideoPanelViewport({ revealPanel }: UseVideoPanelViewportParams) {
  const [highlightedPanelKey, setHighlightedPanelKey] = useState<string | null>(null)
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const scrollToPanel = useCallback((storyboardId: string, panelIndex: number) => {
    const panelKey = `${storyboardId}-${panelIndex}`
    const panelElement = panelRefs.current.get(panelKey)
    if (!panelElement) return

    const headerOffset = 140
    const targetY = Math.max(0, window.scrollY + panelElement.getBoundingClientRect().top - headerOffset)
    window.scrollTo({ top: targetY, behavior: 'smooth' })
    setHighlightedPanelKey(panelKey)
    setTimeout(() => setHighlightedPanelKey(null), 3000)
  }, [])

  const locateVoiceLinePanel = useCallback((storyboardId: string, panelIndex: number) => {
    revealPanel(`${storyboardId}-${panelIndex}`)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToPanel(storyboardId, panelIndex)
      })
    })
  }, [revealPanel, scrollToPanel])

  return {
    panelRefs,
    highlightedPanelKey,
    locateVoiceLinePanel,
  }
}
