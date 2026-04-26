export const EPISODE_DATA_PROFILE_DEFAULT = 'full' as const

export const EPISODE_DATA_PROFILES = [
  EPISODE_DATA_PROFILE_DEFAULT,
  'config',
  'workspace-visual',
  'storyboard',
  'videos',
  'voice',
] as const

export type EpisodeDataProfile = (typeof EPISODE_DATA_PROFILES)[number]

export function normalizeEpisodeDataProfile(value: string | null | undefined): EpisodeDataProfile {
  if (!value) return EPISODE_DATA_PROFILE_DEFAULT
  return EPISODE_DATA_PROFILES.includes(value as EpisodeDataProfile)
    ? (value as EpisodeDataProfile)
    : EPISODE_DATA_PROFILE_DEFAULT
}
