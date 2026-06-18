'use client'

import { useEffect, useState } from 'react'
import type { ProjectEditScriptShot } from '@/types/project'
import { DETAIL_FIELD_COUNT } from './edit-script-stream-types'

const FIELD_REVEAL_MS = 170
const SHOT_HOLD_MS = 1300
const NEXT_SHOT_DELAY_MS = 240

export interface EditScriptStreamSimulationState {
  readonly activeShotNumber: number | null
  readonly completedCount: number
  readonly manualShotNumber: number | null
  readonly playing: boolean
  readonly revealCount: number
  readonly tableOpen: boolean
  readonly visibleShots: readonly ProjectEditScriptShot[]
  readonly isComplete: boolean
  readonly replay: () => void
  readonly selectShot: (shotNumber: number) => void
  readonly setTableOpen: (updater: (current: boolean) => boolean) => void
  readonly togglePlay: () => void
}

export function useEditScriptStreamSimulation(
  shots: readonly ProjectEditScriptShot[],
  dataSignature: string,
): EditScriptStreamSimulationState {
  const [completedCount, setCompletedCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [revealCount, setRevealCount] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tableOpen, setTableOpen] = useState(true)
  const [manualShotNumber, setManualShotNumber] = useState<number | null>(null)

  useEffect(() => {
    setCompletedCount(0)
    setActiveIndex(null)
    setRevealCount(0)
    setManualShotNumber(null)
    setTableOpen(true)
    setPlaying(shots.length > 0)
  }, [dataSignature, shots.length])

  useEffect(() => {
    if (activeIndex !== null) setTableOpen(true)
  }, [activeIndex])

  useEffect(() => {
    if (!playing || shots.length === 0) return undefined
    if (activeIndex === null) {
      if (completedCount >= shots.length) {
        setPlaying(false)
        return undefined
      }
      const timer = window.setTimeout(() => {
        setActiveIndex(completedCount)
        setRevealCount(0)
        setManualShotNumber(null)
      }, NEXT_SHOT_DELAY_MS)
      return () => window.clearTimeout(timer)
    }
    if (revealCount < DETAIL_FIELD_COUNT) {
      const timer = window.setTimeout(() => {
        setRevealCount((current) => Math.min(current + 1, DETAIL_FIELD_COUNT))
      }, FIELD_REVEAL_MS)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => {
      const nextCompletedCount = activeIndex + 1
      setCompletedCount(nextCompletedCount)
      setActiveIndex(null)
      setRevealCount(0)
      if (nextCompletedCount >= shots.length) {
        setPlaying(false)
      }
    }, SHOT_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [activeIndex, completedCount, playing, revealCount, shots.length])

  const activeShotNumber = activeIndex === null ? null : shots[activeIndex]?.shotNumber ?? null
  const visibleShots = activeIndex === null
    ? shots.slice(0, completedCount)
    : shots.slice(0, activeIndex + 1)
  const isComplete = shots.length > 0 && completedCount >= shots.length && activeIndex === null

  const replay = () => {
    setCompletedCount(0)
    setActiveIndex(null)
    setRevealCount(0)
    setManualShotNumber(null)
    setTableOpen(true)
    setPlaying(shots.length > 0)
  }

  const togglePlay = () => {
    if (shots.length === 0) return
    if (isComplete) {
      replay()
      return
    }
    setPlaying((current) => !current)
  }

  const selectShot = (shotNumber: number) => {
    setManualShotNumber((current) => current === shotNumber ? null : shotNumber)
  }

  return {
    activeShotNumber,
    completedCount,
    manualShotNumber,
    playing,
    revealCount,
    tableOpen,
    visibleShots,
    isComplete,
    replay,
    selectShot,
    setTableOpen,
    togglePlay,
  }
}
