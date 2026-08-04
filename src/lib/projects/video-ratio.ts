export const PROJECT_VIDEO_RATIOS = [
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '9:21',
] as const
export type ProjectVideoRatio = (typeof PROJECT_VIDEO_RATIOS)[number]
