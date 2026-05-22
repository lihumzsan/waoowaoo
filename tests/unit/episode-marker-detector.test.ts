import { describe, expect, it } from 'vitest'
import {
  MAX_EPISODE_WORDS,
  detectEpisodeMarkers,
  splitByMarkers,
} from '@/lib/episode-marker-detector'

describe('episode marker detector', () => {
  it('detects Chinese chapter markers and caps marker splits at 400 words', () => {
    const content = [
      '第一章 初遇',
      '山'.repeat(430),
      '第二章 追问',
      '海'.repeat(430),
    ].join('\n')

    const markerResult = detectEpisodeMarkers(content)

    expect(markerResult.hasMarkers).toBe(true)
    expect(markerResult.markerTypeKey).toBe('chapter')
    expect(markerResult.previewSplits.length).toBeGreaterThan(2)
    expect(markerResult.previewSplits.every((split) => split.wordCount <= MAX_EPISODE_WORDS)).toBe(true)

    const episodes = splitByMarkers(content, markerResult)
    expect(episodes.every((episode) => episode.wordCount <= MAX_EPISODE_WORDS)).toBe(true)
    expect(episodes.map((episode) => episode.number)).toEqual(
      Array.from({ length: episodes.length }, (_, index) => index + 1),
    )
  })
})
